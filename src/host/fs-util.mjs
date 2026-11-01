/**
 * 文件系统小工具：存在性判断、目录大小、原子 JSON 写、目录搬移（同盘 rename，跨盘 copy+校验+删源）。
 * 只用 Node 内置模块。
 */
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * 判断路径是否存在（不抛错）。
 * @param {string} path - 绝对路径。
 * @returns {Promise<boolean>} 是否存在。
 */
export async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 读取一个路径的 stat，缺失或不可读时返回 undefined。
 * @param {string} path - 绝对路径。
 * @returns {Promise<import('node:fs').Stats|undefined>} stat 结果。
 */
export async function statSafe(path) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/**
 * 递归统计一个目录（或文件）的字节数；读不到的子项按 0 计，不抛错。
 * @param {string} path - 绝对路径。
 * @returns {Promise<number>} 字节数。
 */
export async function sizeOf(path) {
  const info = await statSafe(path)
  if (info === undefined) return 0
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await sizeOf(child)
    else if (entry.isFile()) {
      const childInfo = await statSafe(child)
      total += childInfo?.size ?? 0
    }
  }
  return total
}

/**
 * 读取一个 JSON 文件，缺失或畸形时返回 undefined。
 * @param {string} path - 绝对路径。
 * @returns {Promise<unknown>} 解析结果。
 */
export async function readJsonSafe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 原子写 JSON：同目录临时文件 + fsync 语义的 rename，避免读到半个文件。
 * @param {string} path - 目标绝对路径。
 * @param {unknown} value - 可 JSON 序列化的值。
 * @returns {Promise<void>} 写完即 resolve。
 */
export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/** 短暂等待（Windows 上被杀软/索引器短暂占用后重试通常就好了）。 */
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Windows 上可重试的文件系统错误码。 */
const RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE'])

/** 是否值得重试（Windows 上句柄/只读属性导致的失败）。 */
function isRetryable(error) {
  return process.platform === 'win32' && RETRYABLE_FS_CODES.has(error?.code)
}

/** 递归去掉只读属性（Windows 上只读文件会让 rm/rename 失败）；失败不抛错。 */
async function clearReadonly(path) {
  if (process.platform !== 'win32') return
  try {
    const info = await lstat(path)
    if (info.isDirectory()) {
      await chmod(path, 0o666).catch(() => {})
      for (const entry of await readdir(path, { withFileTypes: true })) {
        await clearReadonly(join(path, entry.name))
      }
    } else {
      await chmod(path, 0o666).catch(() => {})
    }
  } catch {
    /* 清属性尽力而为 */
  }
}

/**
 * 删除一个目录树（不存在视为成功）。
 * Windows 上句柄占用/只读属性会短暂失败，做退避重试并在失败时清一次只读属性。
 * @param {string} path - 绝对路径。
 * @returns {Promise<void>} 删除完成。
 */
export async function removeTree(path) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
      return
    } catch (error) {
      if (attempt >= 5 || !isRetryable(error)) throw error
      await clearReadonly(path)
      await sleep(150 * (attempt + 1))
    }
  }
}

/** 判断一个错误是否是跨设备（EXDEV）错误。 */
const isCrossDevice = error => error?.code === 'EXDEV'

/**
 * 复制一个目录树到目标路径（目标必须不存在或为空）。
 * @param {string} source - 源目录。
 * @param {string} target - 目标目录。
 * @returns {Promise<void>} 复制完成。
 */
async function copyTree(source, target) {
  const info = await stat(source)
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true })
    for (const entry of await readdir(source, { withFileTypes: true })) {
      await copyTree(join(source, entry.name), join(target, entry.name))
    }
    return
  }
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}

/**
 * 校验复制结果：逐文件比对字节数，避免跨盘搬移留下半个会话。
 * @param {string} source - 源目录。
 * @param {string} target - 目标目录。
 * @returns {Promise<{files: number, bytes: number}>} 校验通过的统计。
 */
async function verifyTree(source, target) {
  let files = 0
  let bytes = 0
  const info = await stat(source)
  if (info.isDirectory()) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const child = await verifyTree(join(source, entry.name), join(target, entry.name))
      files += child.files
      bytes += child.bytes
    }
    return { files, bytes }
  }
  const copied = await stat(target)
  if (copied.size !== info.size) {
    throw new Error(`跨盘复制校验失败：${target} 期望 ${info.size} 字节，实际 ${copied.size} 字节`)
  }
  return { files: 1, bytes: info.size }
}

/**
 * 把一个目录搬到目标位置。同盘用 `rename`（原子）；跨盘退化为
 * 复制 → 逐文件校验 → 删除源目录，任一步失败都清掉半成品目标。
 * @param {string} source - 源目录绝对路径。
 * @param {string} target - 目标目录绝对路径（父目录会被创建）。
 * @returns {Promise<{mode: 'rename'|'copy', files: number, bytes: number}>} 搬移方式与统计。
 */
export async function moveTree(source, target) {
  await mkdir(dirname(target), { recursive: true })
  let renameError
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, target)
      return { mode: 'rename', files: 0, bytes: 0 }
    } catch (error) {
      renameError = error
      // Windows 上目标被短暂占用会 EPERM/EBUSY；跨卷才是 EXDEV。
      if (!isCrossDevice(error) && !isRetryable(error)) throw error
      if (isCrossDevice(error)) break
      await sleep(150 * (attempt + 1))
    }
  }
  if (renameError !== undefined && !isCrossDevice(renameError) && !isRetryable(renameError)) throw renameError
  await copyTree(source, target)
  let verified
  try {
    verified = await verifyTree(source, target)
  } catch (error) {
    await removeTree(target).catch(() => {})
    throw error
  }
  // 目标已逐文件校验通过；删源失败（Windows 句柄/权限）时不能把校验过的副本也丢掉：
  // 保留目标并把清理失败作为警告交给调用方，源目录残留可稍后清理。
  let sourceCleanupWarning = ''
  try {
    await removeTree(source)
  } catch (error) {
    sourceCleanupWarning = `跨盘搬移后源目录清理失败：${error instanceof Error ? error.message : String(error)}`
  }
  return { mode: 'copy', files: verified.files, bytes: verified.bytes, sourceCleanupWarning }
}
