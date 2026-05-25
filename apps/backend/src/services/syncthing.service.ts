import { exec } from '../lib/exec.js'
import { readFileSync, existsSync } from 'node:fs'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncthingStatus {
  installed: boolean
  active: boolean
  deviceId: string | null
  apiKey: string | null
  version: string | null
}

export interface SyncthingDevice {
  deviceID: string
  name: string
  addresses: string[]
  paused: boolean
}

export interface SyncthingFolder {
  id: string
  label: string
  path: string
  devices: Array<{ deviceID: string }>
  type: string
  paused: boolean
}

export interface SyncthingCompletion {
  completion: number
  globalBytes: number
  globalItems: number
  needBytes: number
  needItems: number
  remoteState: string
}

export interface FolderSyncStatus {
  folderId: string
  completion: number
  needBytes: number
  globalBytes: number
}

// ─── API helper ───────────────────────────────────────────────────────────────

const SYNCTHING_BASE = 'http://localhost:8384'

async function stApi<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  apiKey: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${SYNCTHING_BASE}${path}`, {
    method,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Syncthing API error ${res.status}: ${text}`)
  }
  // DELETE responses are often empty
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return {} as T
  }
  return res.json() as Promise<T>
}

// ─── Key extraction ───────────────────────────────────────────────────────────

// Syncthing moved config location across versions:
//   < 1.27 : ~/.config/syncthing/config.xml
//   >= 1.27 : ~/.local/state/syncthing/config.xml  (XDG state dir)
const SYNCTHING_CONFIG_PATHS = [
  '/root/.local/state/syncthing/config.xml',
  '/root/.config/syncthing/config.xml',
]

export function getApiKey(): string | null {
  for (const path of SYNCTHING_CONFIG_PATHS) {
    try {
      if (!existsSync(path)) continue
      const xml = readFileSync(path, 'utf8')
      const match = xml.match(/<apikey>([^<]+)<\/apikey>/i)
      if (match) return match[1].trim()
    } catch {
      // try next path
    }
  }
  return null
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function getSyncthingStatus(): Promise<SyncthingStatus> {
  // 1. Check if installed
  const whichResult = await exec('which', ['syncthing'])
  const installed = whichResult.exitCode === 0

  if (!installed) {
    return { installed: false, active: false, deviceId: null, apiKey: null, version: null }
  }

  // 2. Check if active via systemctl
  const activeResult = await exec('systemctl', ['is-active', 'syncthing@root'])
  const active = activeResult.stdout.trim() === 'active'

  const apiKey = getApiKey()

  if (!active || !apiKey) {
    return { installed, active, deviceId: null, apiKey, version: null }
  }

  // 3. Get device ID from REST API
  try {
    const status = await stApi<{ myID: string; version: string }>('GET', '/rest/system/status', apiKey)
    return {
      installed,
      active,
      deviceId: status.myID ?? null,
      apiKey,
      version: status.version ?? null,
    }
  } catch {
    return { installed, active, deviceId: null, apiKey, version: null }
  }
}

export async function installSyncthing(): Promise<void> {
  const aptResult = await exec('apt-get', ['install', '-y', 'syncthing'])
  if (aptResult.exitCode !== 0) {
    throw new Error(`apt-get install failed: ${aptResult.stderr}`)
  }
  const enableResult = await exec('systemctl', ['enable', '--now', 'syncthing@root'])
  if (enableResult.exitCode !== 0) {
    throw new Error(`systemctl enable failed: ${enableResult.stderr}`)
  }
}

export async function startSyncthing(): Promise<void> {
  const result = await exec('systemctl', ['start', 'syncthing@root'])
  if (result.exitCode !== 0) {
    throw new Error(`systemctl start failed: ${result.stderr}`)
  }
}

export async function stopSyncthing(): Promise<void> {
  const result = await exec('systemctl', ['stop', 'syncthing@root'])
  if (result.exitCode !== 0) {
    throw new Error(`systemctl stop failed: ${result.stderr}`)
  }
}

function requireApiKey(): string {
  const key = getApiKey()
  if (!key) throw new Error('Syncthing API key not found — is Syncthing running?')
  return key
}

export async function listDevices(): Promise<SyncthingDevice[]> {
  const apiKey = requireApiKey()
  return stApi<SyncthingDevice[]>('GET', '/rest/config/devices', apiKey)
}

export async function addDevice(deviceId: string, name: string): Promise<void> {
  const apiKey = requireApiKey()
  // POST /rest/config/devices expects a single device object (not the full array)
  await stApi<unknown>('POST', '/rest/config/devices', apiKey, {
    deviceID: deviceId,
    name,
    addresses: ['dynamic'],
    paused: false,
  })
}

export async function removeDevice(deviceId: string): Promise<void> {
  const apiKey = requireApiKey()
  // encodeURIComponent the device ID (contains dashes and uppercase — safe, but good practice)
  await stApi<unknown>('DELETE', `/rest/config/devices/${encodeURIComponent(deviceId)}`, apiKey)
}

export async function listFolders(): Promise<SyncthingFolder[]> {
  const apiKey = requireApiKey()
  return stApi<SyncthingFolder[]>('GET', '/rest/config/folders', apiKey)
}

export async function addFolder(
  id: string,
  path: string,
  sharedWithDevices: string[]
): Promise<void> {
  const apiKey = requireApiKey()
  // POST /rest/config/folders expects a single folder object (not the full array)
  await stApi<unknown>('POST', '/rest/config/folders', apiKey, {
    id,
    label: id,
    path,
    devices: sharedWithDevices.map((deviceID) => ({ deviceID })),
    type: 'sendreceive',
    paused: false,
  })
}

export async function removeFolder(id: string): Promise<void> {
  const apiKey = requireApiKey()
  await stApi<unknown>('DELETE', `/rest/config/folders/${encodeURIComponent(id)}`, apiKey)
}

export async function getSyncStatus(): Promise<FolderSyncStatus[]> {
  const apiKey = requireApiKey()
  const folders = await stApi<SyncthingFolder[]>('GET', '/rest/config/folders', apiKey)
  const results: FolderSyncStatus[] = []

  for (const folder of folders) {
    try {
      const completion = await stApi<SyncthingCompletion>(
        'GET',
        `/rest/db/completion?folder=${encodeURIComponent(folder.id)}`,
        apiKey
      )
      results.push({
        folderId: folder.id,
        completion: Math.round(completion.completion ?? 100),
        needBytes: completion.needBytes ?? 0,
        globalBytes: completion.globalBytes ?? 0,
      })
    } catch {
      results.push({ folderId: folder.id, completion: 0, needBytes: 0, globalBytes: 0 })
    }
  }

  return results
}
