import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { exec, execWithInput } from '../lib/exec.js'

export type DriveType = 'webdav' | 'sftp' | 's3' | 'smb' | 'ftp' | 'b2'

export interface NetworkDrive {
  id: number
  name: string
  type: DriveType
  config: Record<string, string>
  mount_point: string
  is_mounted: number
  auto_mount: number
  created_at: number
}

const CONF_PATH = '/opt/homenas-v3/data/rclone/network-drives.conf'
const MOUNT_BASE = '/mnt/network'
const SYSTEMD_DIR = '/etc/systemd/system'

function sanitizeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
}

async function readConf(): Promise<string> {
  try {
    return await readFile(CONF_PATH, 'utf-8')
  } catch {
    return ''
  }
}

async function writeConf(content: string): Promise<void> {
  await mkdir(join(CONF_PATH, '..'), { recursive: true })
  await writeFile(CONF_PATH, content, 'utf-8')
}

function rcloneType(type: DriveType): string {
  return type  // rclone 1.63+ uses these names directly
}

// rclone INI keys: rclone allows letters, digits, underscore and hyphen.
// Reject anything else to avoid breaking the parser or smuggling new keys.
const INI_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/

function assertSafeIniKey(key: string): void {
  if (!INI_KEY_RE.test(key)) {
    throw new Error(`Invalid config key: ${key}`)
  }
}

// Reject characters that would let a value start a new section, comment line,
// or break the INI parser. \r and \n are the most dangerous (allow injecting
// `\n[other-section]\n` to overwrite/create unrelated remotes).
function assertSafeIniValue(key: string, value: string): void {
  if (/[\r\n\x00]/.test(value)) {
    throw new Error(`Invalid characters in value for key "${key}"`)
  }
}

// rclone stores certain secrets "obscured" (reversibly scrambled), NOT in
// plaintext. A plaintext password in the config makes rclone fail to connect
// with "input too short when revealing password - is it obscured?", so the
// drive mounts but shows no content. These keys must be passed through
// `rclone obscure` before being written to the config.
const OBSCURED_KEYS = new Set(['pass'])

async function obscureSecret(plain: string): Promise<string> {
  // Feed via stdin so the plaintext never appears in the process list.
  const r = await execWithInput('rclone', ['obscure', '-'], plain)
  const out = r.stdout.trim()
  if (r.exitCode !== 0 || !out) {
    throw new Error('No se pudo cifrar la contraseña (rclone obscure falló)')
  }
  return out
}

// Returns a copy of `config` with password-like fields obscured for rclone.
async function obscureConfigSecrets(config: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(config)) {
    out[k] = OBSCURED_KEYS.has(k) && v && v.trim() ? await obscureSecret(v) : v
  }
  return out
}

function buildRemoteSection(name: string, type: DriveType, config: Record<string, string>): string {
  const lines = [`[${name}]`, `type = ${rcloneType(type)}`]
  for (const [k, v] of Object.entries(config)) {
    if (!v || !v.trim()) continue
    assertSafeIniKey(k)
    assertSafeIniValue(k, v)
    lines.push(`${k} = ${v}`)
  }
  return lines.join('\n') + '\n'
}

function removeSection(conf: string, name: string): string {
  const lines = conf.split('\n')
  const result: string[] = []
  let skip = false
  for (const line of lines) {
    if (line.trim() === `[${name}]`) { skip = true; continue }
    if (skip && line.startsWith('[')) skip = false
    if (!skip) result.push(line)
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

async function upsertInConf(name: string, type: DriveType, config: Record<string, string>): Promise<void> {
  const secured = await obscureConfigSecrets(config)
  const existing = await readConf()
  const cleaned = removeSection(existing, name)
  const updated = (cleaned.trimEnd() + '\n\n' + buildRemoteSection(name, type, secured)).trimStart()
  await writeConf(updated)
}

async function removeFromConf(name: string): Promise<void> {
  const content = await readConf()
  await writeConf(removeSection(content, name))
}

function serviceUnitName(name: string): string {
  return `rclone-net-${name}.service`
}

function serviceFilePath(name: string): string {
  return join(SYSTEMD_DIR, serviceUnitName(name))
}

function buildServiceFile(name: string, mountPoint: string): string {
  return `[Unit]
Description=rclone network drive: ${name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStartPre=/bin/mkdir -p ${mountPoint}
ExecStart=/usr/bin/rclone mount ${name}: ${mountPoint} --config ${CONF_PATH} --allow-other --vfs-cache-mode full --dir-cache-time 5m --poll-interval 30s --log-level ERROR
ExecStop=/bin/fusermount3 -uz ${mountPoint}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`
}

async function isMounted(mountPoint: string): Promise<boolean> {
  try {
    const mounts = await readFile('/proc/mounts', 'utf-8')
    return mounts.split('\n').some(line => {
      const parts = line.split(' ')
      return parts[1] === mountPoint && (parts[2]?.startsWith('fuse') ?? false)
    })
  } catch {
    return false
  }
}

export function createNetworkDrivesService(db: Database.Database) {
  const listStmt     = db.prepare('SELECT * FROM network_drives ORDER BY created_at ASC')
  const getStmt      = db.prepare('SELECT * FROM network_drives WHERE id = ?')
  const getByNameStmt = db.prepare('SELECT id FROM network_drives WHERE name = ?')
  const insertStmt   = db.prepare(
    'INSERT INTO network_drives (name, type, config, mount_point, auto_mount) VALUES (?, ?, ?, ?, ?)'
  )
  const setMountedStmt = db.prepare('UPDATE network_drives SET is_mounted = ? WHERE id = ?')
  const deleteStmt   = db.prepare('DELETE FROM network_drives WHERE id = ?')

  function parseRow(row: Record<string, unknown>): NetworkDrive {
    return { ...(row as unknown as NetworkDrive), config: JSON.parse((row.config as string) ?? '{}') }
  }

  return {
    listDrives(): NetworkDrive[] {
      return (listStmt.all() as Record<string, unknown>[]).map(parseRow)
    },

    async addDrive(
      name: string,
      type: DriveType,
      config: Record<string, string>,
      autoMount: boolean,
    ): Promise<NetworkDrive> {
      const safeName = sanitizeName(name)
      if (!safeName) throw new Error('Nombre de unidad inválido')

      if (getByNameStmt.get(safeName)) throw new Error('Ya existe una unidad con ese nombre')

      const mountPoint = join(MOUNT_BASE, safeName)

      await upsertInConf(safeName, type, config)
      await exec('mkdir', ['-p', mountPoint])

      const result = insertStmt.run(safeName, type, JSON.stringify(config), mountPoint, autoMount ? 1 : 0)
      const drive = parseRow(getStmt.get(result.lastInsertRowid) as unknown as Record<string, unknown>)

      if (autoMount) {
        try {
          await this.mountDrive(drive.id)
        } catch (mountErr) {
          // Roll back DB entry so the user can retry without "Ya existe" error
          deleteStmt.run(drive.id)
          await removeFromConf(safeName)
          throw mountErr
        }
      }

      return drive
    },

    async mountDrive(id: number): Promise<void> {
      const row = getStmt.get(id) as Record<string, unknown> | undefined
      if (!row) throw new Error('Drive not found')
      const drive = parseRow(row)

      // Ensure config is in the conf file (may have been removed)
      await upsertInConf(drive.name, drive.type, drive.config)

      await exec('mkdir', ['-p', drive.mount_point])

      const serviceContent = buildServiceFile(drive.name, drive.mount_point)
      await execWithInput('tee', [serviceFilePath(drive.name)], serviceContent)

      await exec('systemctl', ['daemon-reload'])

      const startResult = await exec('systemctl', ['start', serviceUnitName(drive.name)])
      if (startResult.exitCode !== 0) {
        throw new Error(`Error al montar: ${startResult.stderr || startResult.stdout}`)
      }

      if (drive.auto_mount) {
        await exec('systemctl', ['enable', serviceUnitName(drive.name)])
      }

      setMountedStmt.run(1, id)
    },

    async unmountDrive(id: number): Promise<void> {
      const row = getStmt.get(id) as Record<string, unknown> | undefined
      if (!row) throw new Error('Drive not found')
      const drive = parseRow(row)

      await exec('systemctl', ['stop', serviceUnitName(drive.name)])
      await exec('systemctl', ['disable', serviceUnitName(drive.name)])

      // Remove unit file
      await exec('rm', ['-f', serviceFilePath(drive.name)])
      await exec('systemctl', ['daemon-reload'])

      // Force unmount if still mounted
      if (await isMounted(drive.mount_point)) {
        await exec('fusermount3', ['-u', drive.mount_point])
      }

      setMountedStmt.run(0, id)
    },

    async deleteDrive(id: number): Promise<void> {
      const row = getStmt.get(id) as Record<string, unknown> | undefined
      if (!row) throw new Error('Drive not found')
      const drive = parseRow(row)

      if (drive.is_mounted) {
        try { await this.unmountDrive(id) } catch { /* best effort */ }
      }

      await removeFromConf(drive.name)
      await exec('rmdir', ['--ignore-fail-on-non-empty', drive.mount_point])
      deleteStmt.run(id)
    },
  }
}
