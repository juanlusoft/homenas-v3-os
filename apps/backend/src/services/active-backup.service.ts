import { randomBytes, createHash } from 'node:crypto'
import {
  mkdirSync, readdirSync, lstatSync, symlinkSync, unlinkSync,
  existsSync, rmSync, createWriteStream, linkSync, readFileSync, writeFileSync,
} from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { execa, type Subprocess } from 'execa'
import type { Database } from 'better-sqlite3'
import { createActiveBackupRepo } from '../repositories/active-backup.repo.js'
import type { AbDevice, AbBackupRun, AbProgress, AbFileEntry, ManifestEntry, UpdateDeviceInput } from '@homenas/shared'

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_ROOT = process.env.AB_STORAGE_ROOT ?? '/mnt/storage/active-backup'

// ─── Module-level running state (one backup per device at a time) ─────────────

interface RunningBackup {
  deviceId: number
  runId: number
  output: string[]
  startedAt: number
  process: Subprocess
}

const runningBackups = new Map<number, RunningBackup>()

// ─── Path helpers ─────────────────────────────────────────────────────────────

function deviceRoot(deviceId: number): string {
  return join(STORAGE_ROOT, String(deviceId))
}

function versionPath(deviceId: number, version: string): string {
  return join(deviceRoot(deviceId), version)
}

/**
 * Validate a browsing sub-path so it cannot escape the device's root.
 * Returns resolved absolute path or throws.
 */
function safeBrowsePath(deviceId: number, subPath: string): string {
  const root = resolve(deviceRoot(deviceId))
  // Normalise and resolve against root
  const candidate = resolve(join(root, subPath.replace(/^\/+/, '')))
  if (!candidate.startsWith(root + '/') && candidate !== root) {
    throw new Error('Path traversal not allowed')
  }
  return candidate
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Sanitize a relative file path for use as a filesystem key.
 * Removes leading slashes, normalizes separators, prevents traversal.
 */
function sanitizePath(p: string): string {
  // Split into segments and drop empty/'.'/'..' components. Segment-based
  // filtering cannot be bypassed the way a single `.replace(/\.\.+\//)` can
  // (e.g. `....//` or `..../`), because there is no residual string to re-form
  // a traversal sequence after the filter.
  return p
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .join('/')
}

/**
 * Resolve a relative path under a trusted base directory, guaranteeing the
 * result stays inside it. Throws on any traversal attempt.
 */
function confineToBase(base: string, relPath: string): string {
  const resolvedBase = resolve(base)
  const full = resolve(join(resolvedBase, sanitizePath(relPath)))
  if (full !== resolvedBase && !full.startsWith(resolvedBase + '/')) {
    throw new Error('Path traversal not allowed')
  }
  return full
}

// ─── Token generation ─────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function createActiveBackupService(db: Database) {
  const repo = createActiveBackupRepo(db)

  return {
    // ── Device management ──────────────────────────────────────────────────

    listDevices(limit = 50, offset = 0): { items: AbDevice[]; total: number } {
      return { items: repo.listDevices(limit, offset), total: repo.countDevices() }
    },

    getDevice(id: number): AbDevice {
      const device = repo.getDevice(id)
      if (!device) throw new Error('Device not found')
      return device
    },

    approveDevice(id: number): AbDevice {
      const device = repo.getDevice(id)
      if (!device) throw new Error('Device not found')
      if (device.status !== 'pending') throw new Error('Device is not pending approval')
      repo.updateDeviceStatus(id, 'approved')
      return repo.getDevice(id)!
    },

    deleteDevice(id: number): void {
      const device = repo.getDevice(id)
      if (!device) throw new Error('Device not found')

      // Cancel any running backup for this device
      const running = runningBackups.get(id)
      if (running) {
        try { running.process.kill('SIGTERM') } catch { /* ignore */ }
        runningBackups.delete(id)
      }

      repo.deleteDevice(id)
    },

    // ── Agent endpoints ────────────────────────────────────────────────────

    registerDevice(input: {
      name: string
      hostname: string | null
      os_type: string
    }): { token: string; id: number; status: string } {
      const token = generateToken()
      const device = repo.createDevice({
        name: input.name,
        hostname: input.hostname,
        os_type: input.os_type,
        token,
      })
      return { token: device.token, id: device.id, status: device.status }
    },

    pollForTask(token: string): { status: 'pending' | 'waiting' } | {
      status: 'backup'
      run_id: number
      backup_path: string
      retention_days: number
    } {
      const device = repo.getDeviceByToken(token)
      if (!device) throw new Error('Unknown token')

      // Update last_seen timestamp
      repo.updateDeviceLastSeen(device.id)

      if (device.status === 'pending') {
        return { status: 'pending' }
      }

      // Check if there is already a running run for this device (triggered by admin)
      const runningRun = repo.getRunningRunForDevice(device.id)
      if (!runningRun) {
        return { status: 'waiting' }
      }

      return {
        status: 'backup',
        run_id: runningRun.id,
        backup_path: device.backup_path ?? '/home',
        retention_days: device.retention_days,
      }
    },

    reportRunResult(input: {
      token: string
      run_id: number
      status: 'success' | 'error' | 'cancelled'
      size_bytes: number | null
      files_count: number | null
      error_message: string | null
    }): void {
      const device = repo.getDeviceByToken(input.token)
      if (!device) throw new Error('Unknown token')

      const run = repo.getRunById(input.run_id)
      if (!run) throw new Error('Run not found')
      if (run.device_id !== device.id) throw new Error('Run does not belong to this device')

      repo.finishRun(input.run_id, {
        status: input.status,
        size_bytes: input.size_bytes,
        files_count: input.files_count,
        error_message: input.error_message,
      })

      // Update device status based on result
      const newStatus: AbDevice['status'] = input.status === 'success' ? 'active' : 'error'
      repo.updateDeviceStatus(device.id, newStatus)
    },

    // ── Backup trigger (rsync pull-mode via SSH) ───────────────────────────

    triggerBackup(deviceId: number): { run_id: number } {
      const device = repo.getDevice(deviceId)
      if (!device) throw new Error('Device not found')
      if (device.status === 'pending') throw new Error('Device not yet approved')

      if (runningBackups.has(deviceId)) {
        throw new Error('A backup is already running for this device')
      }

      // Determine next version number
      const root = deviceRoot(deviceId)
      mkdirSync(root, { recursive: true })

      let nextVersionNum = 1
      if (existsSync(root)) {
        const entries = readdirSync(root).filter(e => /^v\d+$/.test(e))
        if (entries.length > 0) {
          const nums = entries.map(e => parseInt(e.slice(1), 10))
          nextVersionNum = Math.max(...nums) + 1
        }
      }

      const version = `v${nextVersionNum}`
      const destPath = versionPath(deviceId, version)
      mkdirSync(destPath, { recursive: true })

      // Create the run record
      const run = repo.createRun(deviceId, version)

      // Build rsync args
      // Source: agent's backup_path on the remote host (agent side)
      // This is a pull via SSH: rsync [opts] user@host:path /local/dest
      const backupSrc = device.backup_path ?? '/home'
      const sshTarget = `root@${device.hostname ?? device.name}:${backupSrc}/`

      // Find previous version for --link-dest
      const prevVersionNum = nextVersionNum - 1
      const linkDestArgs: string[] = []
      if (prevVersionNum >= 1) {
        const prevPath = versionPath(deviceId, `v${prevVersionNum}`)
        if (existsSync(prevPath)) {
          linkDestArgs.push(`--link-dest=../v${prevVersionNum}`)
        }
      }

      const rsyncArgs = [
        '--archive',
        '--delete',
        '--stats',
        '--human-readable',
        ...linkDestArgs,
        sshTarget,
        destPath + '/',
      ]

      repo.updateDeviceStatus(deviceId, 'active')

      const proc = execa('rsync', rsyncArgs, {
        shell: false,
        reject: false,
        all: true,
      })

      const outputLines: string[] = []

      runningBackups.set(deviceId, {
        deviceId,
        runId: run.id,
        output: outputLines,
        startedAt: Math.floor(Date.now() / 1000),
        process: proc,
      })

      // Capture output
      if (proc.all) {
        proc.all.on('data', (chunk: Buffer | string) => {
          const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
          for (const line of text.split('\n')) {
            const trimmed = line.trimEnd()
            if (trimmed) {
              outputLines.push(trimmed)
              if (outputLines.length > 1000) outputLines.shift()
            }
          }
        })
      }

      // Handle completion
      void proc.then((result) => {
        const exitCode = result.exitCode ?? 1
        const success = exitCode === 0

        // Parse stats from rsync output
        let sizeBytes: number | null = null
        let filesCount: number | null = null
        for (const line of outputLines) {
          const totalMatch = line.match(/Total transferred file size:\s+([\d,]+)/)
          if (totalMatch) {
            sizeBytes = parseInt(totalMatch[1].replace(/,/g, ''), 10)
          }
          const filesMatch = line.match(/Number of regular files transferred:\s+([\d,]+)/)
          if (filesMatch) {
            filesCount = parseInt(filesMatch[1].replace(/,/g, ''), 10)
          }
        }

        repo.finishRun(run.id, {
          status: success ? 'success' : 'error',
          size_bytes: sizeBytes,
          files_count: filesCount,
          error_message: success ? null : outputLines.slice(-5).join('\n'),
        })

        const newStatus: AbDevice['status'] = success ? 'active' : 'error'
        repo.updateDeviceStatus(deviceId, newStatus)

        // Update `latest` symlink
        if (success) {
          const latestLink = join(deviceRoot(deviceId), 'latest')
          try {
            if (existsSync(latestLink)) unlinkSync(latestLink)
            symlinkSync(version, latestLink)
          } catch { /* non-fatal */ }

          // Prune old versions beyond retention_days
          const device2 = repo.getDevice(deviceId)
          if (device2) {
            pruneOldVersions(deviceId, device2.retention_days)
          }
        }

        runningBackups.delete(deviceId)
      })

      return { run_id: run.id }
    },

    getRunProgress(deviceId: number): AbProgress {
      const running = runningBackups.get(deviceId)
      if (!running) {
        return {
          deviceId: null,
          running: false,
          runId: null,
          progress: 0,
          status: 'idle',
          output: [],
          error: null,
        }
      }

      const { output, runId } = running
      let progress = 0
      for (let i = output.length - 1; i >= 0; i--) {
        const match = output[i].match(/(\d+)%/)
        if (match) {
          progress = parseInt(match[1], 10)
          break
        }
      }

      return {
        deviceId,
        running: true,
        runId,
        progress,
        status: 'running',
        output: output.slice(-20),
        error: null,
      }
    },

    cancelBackup(deviceId: number): void {
      const running = runningBackups.get(deviceId)
      if (!running) throw new Error('No backup is running for this device')

      try { running.process.kill('SIGTERM') } catch { /* ignore */ }

      repo.finishRun(running.runId, {
        status: 'cancelled',
        error_message: 'Cancelled by admin',
      })
      repo.updateDeviceStatus(deviceId, 'error')
      runningBackups.delete(deviceId)
    },

    // ── Versions & file browser ────────────────────────────────────────────

    listVersions(deviceId: number): { version: string; path: string }[] {
      const root = deviceRoot(deviceId)
      if (!existsSync(root)) return []
      const entries = readdirSync(root).filter(e => /^v\d+$/.test(e))
      entries.sort((a, b) => {
        const na = parseInt(a.slice(1), 10)
        const nb = parseInt(b.slice(1), 10)
        return nb - na // newest first
      })
      return entries.map(v => ({ version: v, path: join(root, v) }))
    },

    browseFiles(deviceId: number, version: string, subPath: string): AbFileEntry[] {
      // Validate version format
      if (!/^v\d+$/.test(version) && version !== 'latest') {
        throw new Error('Invalid version format')
      }

      const basePath = versionPath(deviceId, version)
      const fullPath = safeBrowsePath(deviceId, join(version, subPath.replace(/^\/+/, '')))

      if (!existsSync(basePath)) throw new Error('Version not found')
      if (!existsSync(fullPath)) throw new Error('Path not found')

      const stat = lstatSync(fullPath)
      if (!stat.isDirectory()) throw new Error('Path is not a directory')

      const entries = readdirSync(fullPath)
      const result: AbFileEntry[] = []

      for (const entry of entries) {
        try {
          const entryPath = join(fullPath, entry)
          const s = lstatSync(entryPath)
          result.push({
            name: entry,
            type: s.isDirectory() ? 'directory' : 'file',
            size: s.isFile() ? s.size : null,
            modified: Math.floor(s.mtimeMs / 1000),
          })
        } catch { /* skip unreadable entries */ }
      }

      // Directories first, then files; alphabetical within each group
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return result
    },

    // ── Runs history ───────────────────────────────────────────────────────

    listRuns(deviceId: number): AbBackupRun[] {
      return repo.listRuns(deviceId, 50)
    },

    // ── Device update ──────────────────────────────────────────────────────

    updateDevice(id: number, patch: UpdateDeviceInput): AbDevice {
      const device = repo.getDevice(id)
      if (!device) throw new Error('Device not found')
      repo.updateDevice(id, patch)
      return repo.getDevice(id)!
    },

    // ── Push-based backup: begin session ───────────────────────────────────

    beginBackupSession(token: string, input: {
      device_name: string
      hostname: string | null
      os_type: string
    }): { session_id: string; version: string; previous_version: string | null } {
      const device = repo.getDeviceByToken(token)
      if (!device) throw new Error('Unknown token')
      if (device.status === 'pending') throw new Error('Device not yet approved')

      // Update device name/hostname from agent registration data
      if (input.hostname && input.hostname !== device.hostname) {
        repo.updateDevice(device.id, { hostname: input.hostname })
      }

      // Determine next version
      const root = deviceRoot(device.id)
      mkdirSync(root, { recursive: true })
      let nextNum = 1
      if (existsSync(root)) {
        const entries = readdirSync(root).filter(e => /^v\d+$/.test(e))
        if (entries.length > 0) {
          nextNum = Math.max(...entries.map(e => parseInt(e.slice(1), 10))) + 1
        }
      }
      const version = `v${nextNum}`
      const prevVersion = nextNum > 1 ? `v${nextNum - 1}` : null

      // Create destination directory
      mkdirSync(join(root, version, 'files'), { recursive: true })

      // Create the run record
      const run = repo.createRun(device.id, version)
      repo.updateDeviceStatus(device.id, 'active')

      // Create session
      const sessionId = randomBytes(16).toString('hex')
      repo.createSession({
        id: sessionId,
        device_id: device.id,
        run_id: run.id,
        version,
        previous_version: prevVersion,
      })

      return { session_id: sessionId, version, previous_version: prevVersion }
    },

    // ── Push-based backup: file dedup check ────────────────────────────────

    checkFiles(sessionId: string, token: string, files: ManifestEntry[]): { already_have: string[] } {
      const device = repo.getDeviceByToken(token)
      if (!device) throw new Error('Unknown token')
      const session = repo.getSession(sessionId)
      if (!session || session.device_id !== device.id) throw new Error('Invalid session')

      const already_have: string[] = []

      if (session.previous_version) {
        const manifestPath = join(deviceRoot(device.id), `manifest_${session.previous_version}.json`)
        if (existsSync(manifestPath)) {
          let prevManifest: ManifestEntry[] = []
          try { prevManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { prevManifest = [] }
          const prevMap = new Map(prevManifest.map(e => [e.path, e.hash]))
          for (const f of files) {
            if (prevMap.get(f.path) === f.hash) {
              already_have.push(f.path)
            }
          }
        }
      }

      if (already_have.length > 0) {
        repo.appendSessionAlreadyHave(sessionId, already_have)
      }

      return { already_have }
    },

    // ── Push-based backup: receive file chunk ──────────────────────────────

    async receiveFileChunk(sessionId: string, token: string, opts: {
      path: string
      hash: string
      mtime: number
      size: number
      chunkIndex: number
      totalChunks: number
      dataStream: Readable
    }): Promise<{ ok: boolean; received_chunk: number }> {
      const device = repo.getDeviceByToken(token)
      if (!device) throw new Error('Unknown token')
      const session = repo.getSession(sessionId)
      if (!session || session.device_id !== device.id) throw new Error('Invalid session')

      const tmpDir = join(deviceRoot(device.id), '.tmp', sessionId, sanitizePath(opts.path))
      mkdirSync(tmpDir, { recursive: true })

      const chunkPath = join(tmpDir, `chunk_${opts.chunkIndex}`)
      await pipeline(opts.dataStream, createWriteStream(chunkPath))

      // If this is the last chunk, assemble the file
      if (opts.chunkIndex === opts.totalChunks - 1) {
        // Confine the assembled path to the device's version/files root. The raw
        // `opts.path` is attacker-controlled (multipart field), so it must be
        // sanitized + confined here exactly like the tmp dir above.
        const finalPath = confineToBase(join(deviceRoot(device.id), session.version, 'files'), opts.path)
        mkdirSync(dirname(finalPath), { recursive: true })

        const writer = createWriteStream(finalPath)
        const hasher = createHash('sha256')

        for (let i = 0; i < opts.totalChunks; i++) {
          const cp = join(tmpDir, `chunk_${i}`)
          const data = readFileSync(cp)
          hasher.update(data)
          writer.write(data)
        }
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', resolve)
          writer.on('error', reject)
          writer.end()
        })

        const actualHash = hasher.digest('hex')
        if (actualHash !== opts.hash) {
          // Hash mismatch — remove corrupted file
          try { rmSync(finalPath) } catch { /* ignore */ }
          throw new Error(`Hash mismatch for ${opts.path}: expected ${opts.hash}, got ${actualHash}`)
        }

        // Cleanup tmp chunks
        try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* non-fatal */ }
      }

      return { ok: true, received_chunk: opts.chunkIndex }
    },

    // ── Push-based backup: finalize session ────────────────────────────────

    async endBackupSession(sessionId: string, token: string, opts: {
      files_count: number
      size_bytes: number
      status: 'success' | 'error'
      error_message: string | null
      manifest: ManifestEntry[]
    }): Promise<{ ok: boolean; version: string }> {
      const device = repo.getDeviceByToken(token)
      if (!device) throw new Error('Unknown token')
      const session = repo.getSession(sessionId)
      if (!session || session.device_id !== device.id) throw new Error('Invalid session')

      const root = deviceRoot(device.id)

      if (opts.status === 'success') {
        // Hardlink unchanged files from previous version
        if (session.previous_version && session.already_have.length > 0) {
          const prevFilesRoot = join(root, session.previous_version, 'files')
          const curFilesRoot = join(root, session.version, 'files')
          for (const relPath of session.already_have) {
            const src = join(prevFilesRoot, relPath)
            const dst = join(curFilesRoot, relPath)
            if (existsSync(src) && !existsSync(dst)) {
              try {
                mkdirSync(dirname(dst), { recursive: true })
                linkSync(src, dst)
              } catch { /* non-fatal: file may already exist */ }
            }
          }
        }

        // Write manifest
        const manifestPath = join(root, `manifest_${session.version}.json`)
        writeFileSync(manifestPath, JSON.stringify(opts.manifest, null, 2), 'utf8')

        // Update latest symlink
        const latestLink = join(root, 'latest')
        try {
          if (existsSync(latestLink)) unlinkSync(latestLink)
          symlinkSync(session.version, latestLink)
        } catch { /* non-fatal */ }

        // Prune old versions
        pruneOldVersions(device.id, device.retention_days)
      }

      // Finalize the run record
      repo.finishRun(session.run_id, {
        status: opts.status,
        size_bytes: opts.size_bytes,
        files_count: opts.files_count,
        error_message: opts.error_message,
      })
      repo.updateDeviceStatus(device.id, opts.status === 'success' ? 'active' : 'error')

      // Cleanup tmp dir for this session
      try { rmSync(join(root, '.tmp', sessionId), { recursive: true, force: true }) } catch { /* ignore */ }

      repo.deleteSession(sessionId)

      return { ok: true, version: session.version }
    },

    // ── Restore: browse manifest ───────────────────────────────────────────

    browseVersion(deviceId: number, version: string, subPath: string): {
      name: string; type: 'file' | 'directory'; size: number | null; mtime: number | null; path: string
    }[] {
      const manifestPath = join(deviceRoot(deviceId), `manifest_${version}.json`)

      if (!existsSync(manifestPath)) {
        // Fall back to filesystem browse for rsync-mode backups
        const fsEntries = this.browseFiles(deviceId, version, subPath)
        return fsEntries.map(e => ({
          name: e.name,
          type: e.type,
          size: e.size,
          mtime: e.modified,
          path: e.name,
        }))
      }

      let manifest: ManifestEntry[] = []
      try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { manifest = [] }

      // Normalize subPath: strip leading slash
      const prefix = subPath.replace(/^\/+/, '').replace(/\/$/, '')

      // Get immediate children of subPath
      const seen = new Set<string>()
      const results: { name: string; type: 'file' | 'directory'; size: number | null; mtime: number | null; path: string }[] = []

      for (const entry of manifest) {
        const p = entry.path
        // Must start with prefix
        if (prefix && !p.startsWith(prefix + '/')) continue
        const rest = prefix ? p.slice(prefix.length + 1) : p
        if (!rest) continue

        const parts = rest.split('/')
        const name = parts[0]
        if (!name || seen.has(name)) continue
        seen.add(name)

        if (parts.length === 1) {
          // File
          results.push({ name, type: 'file', size: entry.size, mtime: entry.mtime, path: p })
        } else {
          // Directory
          results.push({ name, type: 'directory', size: null, mtime: null, path: prefix ? `${prefix}/${name}` : name })
        }
      }

      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return results
    },

    // ── Restore: download single file ──────────────────────────────────────

    getRestoreFilePath(deviceId: number, version: string, filePath: string): string {
      if (!/^v\d+$/.test(version) && version !== 'latest') {
        throw new Error('Invalid version format')
      }
      const root = deviceRoot(deviceId)
      const base = join(root, version, 'files')
      // Use the shared confinement helper: `startsWith(resolve(base))` without a
      // trailing separator would allow a sibling dir whose name shares the prefix
      // (e.g. `.../files-evil`). confineToBase enforces the `/` boundary.
      const full = confineToBase(base, filePath)
      if (!existsSync(full)) throw new Error('File not found')
      return full
    },
  }
}

// ─── Retention pruning ────────────────────────────────────────────────────────

function pruneOldVersions(deviceId: number, retentionDays: number): void {
  const root = deviceRoot(deviceId)
  if (!existsSync(root)) return

  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400

  const entries = readdirSync(root).filter(e => /^v\d+$/.test(e))
  for (const entry of entries) {
    try {
      const p = join(root, entry)
      const s = lstatSync(p)
      if (Math.floor(s.mtimeMs / 1000) < cutoff) {
        rmSync(p, { recursive: true, force: true })
      }
    } catch { /* non-fatal */ }
  }
}
