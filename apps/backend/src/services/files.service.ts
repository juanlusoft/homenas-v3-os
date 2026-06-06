import { stat, readdir, readFile, realpath, access, constants as fsConstants } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, normalize, basename, dirname } from 'node:path'
import { exec } from '../lib/exec.js'

// ─── Allowed roots ─────────────────────────────────────────────────────────────

export const ALLOWED_ROOTS = ['/mnt/'] as const
export const READONLY_ROOTS = ['/opt/homenas-v3/'] as const
export const ALL_ALLOWED_ROOTS = [...ALLOWED_ROOTS, ...READONLY_ROOTS]

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string
  type: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  modified: number  // unix timestamp
  permissions: string  // e.g. "drwxr-xr-x"
  disk: string | null  // physical disk label for files; null for dirs or non-MergerFS paths
}

export interface FileInfo {
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  permissions: string
  owner: string
  group: string
  modified: number
  accessed: number
  created: number
}

// ─── Path validation ──────────────────────────────────────────────────────────

export function validatePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Path is required')
  }

  // Normalize resolves ".." and duplicate slashes
  const normalized = normalize(inputPath)

  // Reject if the normalized path contains ".." segments (double-check after normalize)
  if (normalized.includes('..')) {
    throw new Error('Path traversal not allowed')
  }

  // Must start with one of the allowed roots
  const allowed = ALL_ALLOWED_ROOTS.some((root) => normalized.startsWith(root))
  if (!allowed) {
    throw new Error(`Path must start with one of: ${ALL_ALLOWED_ROOTS.join(', ')}`)
  }

  return normalized
}

// Async variant that also resolves symlinks via realpath().
// Use this for operations that read or list existing paths.
// For new paths (upload destinations, mkdir) use validatePath() — realpath would fail.
export async function validateRealPath(inputPath: string): Promise<string> {
  const normalized = validatePath(inputPath)

  let resolved: string
  try {
    resolved = await realpath(normalized)
  } catch {
    // Path doesn't exist yet — fall back to normalized (e.g. new file destination)
    return normalized
  }

  // Verify the resolved (symlink-free) path is still within allowed roots.
  // realpath strips trailing slashes, so "/mnt" must match root "/mnt/".
  const resolvedNorm = resolved.endsWith('/') ? resolved : `${resolved}/`
  const allowed = ALL_ALLOWED_ROOTS.some((root) => resolvedNorm.startsWith(root))
  if (!allowed) {
    throw new Error('Path traversal via symlink not allowed')
  }

  return resolved
}

export function validateWritablePath(inputPath: string): string {
  const normalized = validatePath(inputPath)

  // Read-only roots: only admins can reach them AND they are read-only
  const isReadonly = READONLY_ROOTS.some((root) => normalized.startsWith(root))
  if (isReadonly) {
    throw new Error('Path is read-only')
  }

  return normalized
}

// Async variant for write operations: resolves symlinks (the path itself or its
// parent if the path doesn't exist yet) and re-validates that the resolved
// location is still inside a writable root. Prevents symlink-based escapes
// such as /mnt/storage/evil → /etc, which would otherwise let a user with
// upload/delete permission rm -rf arbitrary system paths via sudo.
export async function validateWritableRealPath(inputPath: string): Promise<string> {
  const normalized = validateWritablePath(inputPath)

  try {
    const resolved = await realpath(normalized)
    return validateWritablePath(resolved)
  } catch (err) {
    // ENOENT — path doesn't exist yet (upload destination, mkdir target).
    // Validate the parent directory's real path instead.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const parent = dirname(normalized)
  try {
    const realParent = await realpath(parent)
    validateWritablePath(realParent.endsWith('/') ? realParent : `${realParent}/`)
    return join(realParent, basename(normalized))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Parent directory does not exist')
    }
    throw err
  }
}

/** Prevents deleting the pool root directories themselves */
function validateNotRoot(p: string): void {
  const normalized = normalize(p)
  for (const root of ALLOWED_ROOTS) {
    // e.g. /mnt or /mnt/ — must not delete the root mount point itself
    const trimmed = root.replace(/\/$/, '')
    if (normalized === trimmed || normalized === root) {
      throw new Error('Cannot delete a root mount directory')
    }
    // Block deleting direct children like /mnt/pool1 that are exactly one level deep
    // i.e. normalized starts with root, and has no further "/" after the root
    const relative = normalized.slice(root.length)
    if (!relative.includes('/')) {
      throw new Error('Cannot delete top-level pool directory')
    }
  }
}

// ─── octal to rwx ─────────────────────────────────────────────────────────────

function modeToString(mode: number, isDir: boolean): string {
  const r = (n: number) => (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-')
  const owner = (mode >> 6) & 7
  const group = (mode >> 3) & 7
  const other = mode & 7
  const prefix = isDir ? 'd' : '-'
  return `${prefix}${r(owner)}${r(group)}${r(other)}`
}

// ─── MergerFS disk resolver ───────────────────────────────────────────────────

// Builds a resolver that, given a file name inside `currentDir`, returns the
// label of the underlying physical disk (e.g. "disk1") where the file lives.
// Returns null for every entry when `currentDir` is not under a MergerFS mount.
//
// Called once per listDirectory() invocation — the drive list is built once
// and reused for all entries in that directory.
async function buildDiskResolver(
  currentDir: string,
): Promise<((entryName: string) => Promise<string | null>) | null> {
  let mounts: string
  try {
    mounts = await readFile('/proc/mounts', 'utf-8')
  } catch {
    return null
  }

  // Find the fuse.mergerfs mount whose mount point is a prefix of currentDir
  let poolMount = ''
  let driveSource = ''
  for (const line of mounts.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const [source, mountPoint, fsType] = parts
    if (fsType !== 'fuse.mergerfs') continue
    const decoded = (mountPoint ?? '').replace(/\\040/g, ' ')
    const withSlash = decoded.endsWith('/') ? decoded : `${decoded}/`
    const dirWithSlash = currentDir.endsWith('/') ? currentDir : `${currentDir}/`
    if (dirWithSlash.startsWith(withSlash) && withSlash.length > poolMount.length) {
      poolMount = withSlash
      driveSource = source ?? ''
    }
  }

  if (!poolMount || !driveSource) return null

  // Parse the drive list from the MergerFS source field (colon-separated paths)
  const drives = driveSource
    .split(':')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('/'))

  if (drives.length === 0) return null

  // Return a per-file resolver: check each drive for the file's existence
  const relBase = currentDir.slice(poolMount.length - 1) // keep leading /
  return async (entryName: string): Promise<string | null> => {
    const rel = `${relBase}/${entryName}`.replace(/\/+/g, '/')
    for (const drive of drives) {
      const candidate = join(drive, rel)
      try {
        await access(candidate, fsConstants.F_OK)
        // Use last path segment as disk label (e.g. "disk1" from "/mnt/disks/disk1")
        return drive.split('/').filter(Boolean).pop() ?? drive
      } catch {
        // Not on this drive, try next
      }
    }
    return null
  }
}

// ─── listDirectory ────────────────────────────────────────────────────────────

export async function listDirectory(inputPath: string): Promise<FileEntry[]> {
  const safePath = await validateRealPath(inputPath)

  const entries = await readdir(safePath, { withFileTypes: true })
  const results: FileEntry[] = []

  // Build disk resolver once for this directory (null if not under MergerFS)
  const resolveDisk = await buildDiskResolver(safePath)

  for (const entry of entries) {
    const fullPath = join(safePath, entry.name)
    try {
      const s = await stat(fullPath)
      let type: FileEntry['type'] = 'other'
      if (entry.isDirectory()) type = 'dir'
      else if (entry.isFile()) type = 'file'
      else if (entry.isSymbolicLink()) type = 'symlink'

      // Resolve disk only for files/symlinks — dirs span multiple disks
      const disk = (type !== 'dir' && resolveDisk)
        ? await resolveDisk(entry.name)
        : null

      results.push({
        name: entry.name,
        type,
        size: s.size,
        modified: Math.floor(s.mtimeMs / 1000),
        permissions: modeToString(s.mode & 0o777, entry.isDirectory()),
        disk,
      })
    } catch {
      // Skip inaccessible entries
    }
  }

  return results.sort((a, b) => {
    // Directories first, then by name
    if (a.type === 'dir' && b.type !== 'dir') return -1
    if (a.type !== 'dir' && b.type === 'dir') return 1
    return a.name.localeCompare(b.name)
  })
}

// ─── createDirectory ──────────────────────────────────────────────────────────

export async function createDirectory(inputPath: string): Promise<void> {
  const safePath = await validateWritableRealPath(inputPath)
  const result = await exec('mkdir', ['-p', safePath])
  if (result.exitCode !== 0) {
    throw new Error(`mkdir failed: ${result.stderr}`)
  }
  // mkdir runs via sudo (process is unprivileged) so the new dir is owned by root.
  // Chown back to the service user so subsequent uploads/writes don't EACCES.
  await exec('chown', ['homenas:homenas', safePath])
}

// ─── deleteItem ───────────────────────────────────────────────────────────────

export async function deleteItem(inputPath: string): Promise<void> {
  const safePath = await validateWritableRealPath(inputPath)
  validateNotRoot(safePath)

  const result = await exec('rm', ['-rf', safePath])
  if (result.exitCode !== 0) {
    throw new Error(`rm failed: ${result.stderr}`)
  }
}

// ─── renameItem ───────────────────────────────────────────────────────────────

export async function renameItem(oldPath: string, newPath: string): Promise<void> {
  const safeOld = await validateWritableRealPath(oldPath)
  // New path must stay within the same writable area
  const safeNew = await validateWritableRealPath(newPath)

  // newPath must remain in same parent directory
  if (dirname(safeOld) !== dirname(safeNew)) {
    throw new Error('Rename must stay within the same directory — use move for cross-directory operations')
  }

  const result = await exec('mv', [safeOld, safeNew])
  if (result.exitCode !== 0) {
    throw new Error(`mv failed: ${result.stderr}`)
  }
}

// ─── moveItem ─────────────────────────────────────────────────────────────────

export async function moveItem(source: string, destination: string): Promise<void> {
  const safeSrc = await validateWritableRealPath(source)
  const safeDst = await validateWritableRealPath(destination)

  const result = await exec('mv', [safeSrc, safeDst])
  if (result.exitCode !== 0) {
    throw new Error(`mv failed: ${result.stderr}`)
  }
}

// ─── copyItem ─────────────────────────────────────────────────────────────────

export async function copyItem(source: string, destination: string): Promise<void> {
  const safeSrc = await validateRealPath(source)  // source can be read-only
  const safeDst = await validateWritableRealPath(destination)

  const result = await exec('cp', ['-r', safeSrc, safeDst])
  if (result.exitCode !== 0) {
    throw new Error(`cp failed: ${result.stderr}`)
  }
}

// ─── searchFiles ──────────────────────────────────────────────────────────────

export async function searchFiles(basePath: string, query: string): Promise<string[]> {
  const safePath = validatePath(basePath)

  if (!query || query.trim() === '') {
    throw new Error('Search query is required')
  }

  // Sanitize query: strip shell metacharacters and glob breakers. exec runs
  // with shell:false so this is defense-in-depth, but it also avoids the
  // user accidentally producing weird find globs (e.g. "*?[1-9]").
  const safeQuery = query.replace(/[`$\\;|&<>(){}[\]*?!^"']/g, '').slice(0, 128)
  if (!safeQuery.trim()) return []

  const result = await exec('find', [
    safePath,
    '-maxdepth', '5',
    '-name', `*${safeQuery}*`,
  ])

  if (result.exitCode !== 0 && !result.stdout) {
    return []
  }

  const lines = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 100)

  return lines
}

// ─── getFileInfo ──────────────────────────────────────────────────────────────

export async function getFileInfo(inputPath: string): Promise<FileInfo> {
  const safePath = await validateRealPath(inputPath)

  const s = await stat(safePath)

  let type: FileInfo['type'] = 'other'
  if (s.isDirectory()) type = 'dir'
  else if (s.isFile()) type = 'file'
  else if (s.isSymbolicLink()) type = 'symlink'

  // Get owner/group via stat command
  let owner = String(s.uid)
  let group = String(s.gid)

  const statResult = await exec('stat', ['-c', '%U %G', safePath])
  if (statResult.exitCode === 0 && statResult.stdout.trim()) {
    const parts = statResult.stdout.trim().split(' ')
    owner = parts[0] ?? owner
    group = parts[1] ?? group
  }

  return {
    name: basename(safePath),
    path: safePath,
    type,
    size: s.size,
    permissions: modeToString(s.mode & 0o777, s.isDirectory()),
    owner,
    group,
    modified: Math.floor(s.mtimeMs / 1000),
    accessed: Math.floor(s.atimeMs / 1000),
    created: Math.floor(s.birthtimeMs / 1000),
  }
}

// ─── getFileLocations ─────────────────────────────────────────────────────────

export interface FileLocation {
  path: string   // absolute path with trailing slash
  label: string  // human-readable name
  type: 'mergerfs' | 'rclone' | 'generic'
}

/**
 * Returns the list of user-facing storage locations to show in the file manager.
 * Reads /proc/mounts to find fuse.mergerfs pools dynamically — no hardcoded paths.
 * Falls back to /mnt/ if no mergerfs mount is detected (dev environment).
 */
export async function getFileLocations(): Promise<FileLocation[]> {
  const locations: FileLocation[] = []

  try {
    const mounts = await readFile('/proc/mounts', 'utf-8')

    for (const line of mounts.split('\n')) {
      const parts = line.trim().split(/\s+/)
      const fsType = parts[2]
      const mountPoint = parts[1]

      if (fsType === 'fuse.mergerfs' && mountPoint) {
        const decoded = mountPoint.replace(/\\040/g, ' ')
        const normalized = decoded.endsWith('/') ? decoded : `${decoded}/`
        const label = decoded.split('/').filter(Boolean).pop() ?? decoded
        locations.push({ path: normalized, label, type: 'mergerfs' })
      }

      if (fsType === 'fuse.rclone' && mountPoint) {
        const decoded = mountPoint.replace(/\\040/g, ' ')
        const normalized = decoded.endsWith('/') ? decoded : `${decoded}/`
        const label = decoded.split('/').filter(Boolean).pop() ?? decoded
        locations.push({ path: normalized, label, type: 'rclone' })
      }
    }
  } catch {
    // /proc/mounts not available (dev/test environment)
  }

  // Fallback: show /mnt/ as generic root
  if (locations.length === 0 && existsSync('/mnt')) {
    locations.push({ path: '/mnt/', label: 'Almacenamiento', type: 'generic' })
  }

  return locations
}
