import { existsSync, readFileSync } from 'node:fs'
import { execa } from 'execa'
import type { ResultPromise } from 'execa'
import type { Database } from 'better-sqlite3'
import { exec } from '../lib/exec.js'
import { getSetting, setSetting } from '../lib/settings.js'
import type {
  Disk,
  SnapRaidStatus,
  MergerFSStatus,
  MergerFSDrive,
  BadblocksStatus,
  CacheDrainConfig,
  CacheDrainStatus,
} from '@homenas/shared'

// ─── Module-level state ───────────────────────────────────────────────────────

interface SnapRaidState {
  running: boolean
  operation: 'sync' | 'scrub' | 'fix' | 'check' | 'idle'
  progress: number
  status: string
  error: string | null
  lastSync: number | null
  lastScrub: number | null
  process: ResultPromise | null
}

interface BadblocksState {
  running: boolean
  device: string | null
  progress: number
  blocksChecked: number
  badBlocks: number
  status: string
  error: string | null
  process: ResultPromise | null
}

const snapraidState: SnapRaidState = {
  running: false,
  operation: 'idle',
  progress: 0,
  status: 'Inactivo',
  error: null,
  lastSync: null,
  lastScrub: null,
  process: null,
}

const badblocksState: BadblocksState = {
  running: false,
  device: null,
  progress: 0,
  blocksChecked: 0,
  badBlocks: 0,
  status: 'Inactivo',
  error: null,
  process: null,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function isCommandAvailable(command: string): Promise<boolean> {
  const result = await exec('which', [command])
  return result.exitCode === 0
}

// Parse df output to get used bytes for a mount point
async function getUsedBytesForMount(mountPoint: string): Promise<number | null> {
  try {
    const result = await exec('df', ['--block-size=1', '--output=used', mountPoint])
    if (result.exitCode !== 0) return null
    const lines = result.stdout.trim().split('\n')
    // Skip header line
    const valueLine = lines[1]?.trim()
    if (!valueLine) return null
    const used = parseInt(valueLine, 10)
    return isNaN(used) ? null : used
  } catch {
    return null
  }
}

// ─── lsblk disk info ──────────────────────────────────────────────────────────

interface LsblkDevice {
  name: string
  size: string
  fstype: string | null
  mountpoint: string | null
  model: string | null
  serial: string | null
  type: string
  tran: string | null   // transport: nvme, sata, usb, mmc, …
  rota: boolean         // rotational: true=HDD, false=SSD/NVMe
  children?: LsblkDevice[]
}

interface LsblkOutput {
  blockdevices: LsblkDevice[]
}

// Convert lsblk SIZE string (e.g. "931.5G") to bytes
function parseLsblkSize(size: string): number {
  if (!size) return 0
  const units: Record<string, number> = {
    B: 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  }
  const match = size.match(/^([\d.]+)\s*([BKMGTP])?/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = (match[2] ?? 'B').toUpperCase()
  return Math.round(value * (units[unit] ?? 1))
}

// ─── SMART data ───────────────────────────────────────────────────────────────

interface SmartAttribute {
  id: number
  value: number
  worst: number
  thresh: number
  raw: { value: number }
}

interface SmartCtlOutput {
  smart_status?: { passed?: boolean }
  temperature?: { current?: number }
  ata_smart_attributes?: {
    table?: SmartAttribute[]
  }
}

async function getSmartData(deviceName: string): Promise<Disk['smart']> {
  try {
    const result = await exec('smartctl', ['-A', '-H', `/dev/${deviceName}`, '--json'])
    if (result.exitCode !== 0 && result.exitCode !== 4) {
      // exitCode 4 means some SMART data unavailable but we still got JSON
      if (!result.stdout) return null
    }
    const data: SmartCtlOutput = JSON.parse(result.stdout)

    const healthy = data.smart_status?.passed ?? false
    const temperature = data.temperature?.current ?? null

    let powerOnHours: number | null = null
    let reallocatedSectors: number | null = null

    const attrs = data.ata_smart_attributes?.table ?? []
    for (const attr of attrs) {
      // Attribute ID 9 = Power_On_Hours
      // Seagate and some drives pack extra data into the 48-bit raw value making it huge.
      // raw.string contains the correctly decoded value e.g. "51746h+07m+31.827s"
      if (attr.id === 9) {
        const str: string = (attr.raw as { string?: string }).string ?? ''
        const match = str.match(/^(\d+)/)
        powerOnHours = match ? parseInt(match[1], 10) : (attr.raw.value & 0xFFFFFFFF)
      }
      // Attribute ID 5 = Reallocated_Sector_Ct
      if (attr.id === 5) reallocatedSectors = attr.raw.value
      // Attribute ID 194 or 190 = Temperature (fallback if no temperature object)
      if ((attr.id === 194 || attr.id === 190) && temperature === null) {
        // raw.value for temp attrs is typically current temp
      }
    }

    return {
      healthy,
      temperature,
      powerOnHours,
      reallocatedSectors,
    }
  } catch {
    return null
  }
}

// ─── listDisks ────────────────────────────────────────────────────────────────

// Determine disk type from lsblk transport/rotational info.
// This function is architecture-agnostic: it uses the transport and rotational
// flags reported by lsblk rather than assuming fixed device-name mappings.
function resolveDiskType(device: LsblkDevice): Disk['diskType'] {
  const name  = device.name
  const tran  = (device.tran  ?? '').toLowerCase()
  const model = (device.model ?? '').toLowerCase()

  if (tran === 'nvme' || name.startsWith('nvme')) return 'nvme'
  // NVMe drive connected via USB adapter — model name contains "nvme"
  if (tran === 'usb' && model.includes('nvme')) return 'nvme'
  if (tran === 'usb') return 'usb'
  // sata / ata: rotational = HDD, else SSD
  if (tran === 'sata' || tran === 'ata') return device.rota ? 'hdd' : 'ssd'
  // Unknown transport but we can still guess from rotational flag
  if (device.rota === false) return 'ssd'
  if (device.rota === true) return 'hdd'
  return 'other'
}

// Returns true for virtual/system devices that must never be shown in the UI.
// This covers both ARM (mmcblk eMMC, zram) and x86 (loop, dm-*) platforms.
function isHiddenDevice(name: string): boolean {
  return (
    name.startsWith('mmcblk') ||   // eMMC / SD card on ARM/SBC boards
    name.startsWith('zram')   ||   // compressed RAM block device
    name.startsWith('loop')   ||   // loopback (snap packages, etc.)
    name.startsWith('dm-')         // device-mapper (LVM, LUKS, etc.)
  )
}

export async function listDisks(): Promise<Disk[]> {
  const result = await exec('lsblk', [
    '-J', '-b',
    '-o', 'NAME,SIZE,FSTYPE,MOUNTPOINT,MODEL,SERIAL,TYPE,TRAN,ROTA',
  ])

  if (result.exitCode !== 0 || !result.stdout) return []

  let lsblkData: LsblkOutput
  try {
    lsblkData = JSON.parse(result.stdout)
  } catch {
    return []
  }

  const smartAvailable = await isCommandAvailable('smartctl')

  const disks: Disk[] = []

  for (const device of lsblkData.blockdevices) {
    // Only physical top-level disks
    if (device.type !== 'disk') continue

    // Skip eMMC, zram, loop, dm-*
    if (isHiddenDevice(device.name)) continue

    const sizeBytes = typeof device.size === 'string'
      ? parseLsblkSize(device.size)
      : (device.size as unknown as number) ?? 0

    // Skip disconnected / empty slots (0 bytes)
    if (sizeBytes === 0) continue

    // Get used bytes from df if mounted
    let usedBytes: number | null = null
    if (device.mountpoint) {
      usedBytes = await getUsedBytesForMount(device.mountpoint)
    }
    if (usedBytes === null && device.children) {
      for (const child of device.children) {
        if (child.mountpoint) {
          const childUsed = await getUsedBytesForMount(child.mountpoint)
          if (childUsed !== null) usedBytes = (usedBytes ?? 0) + childUsed
        }
      }
    }

    const smart = smartAvailable ? await getSmartData(device.name) : null

    // Sanitise model string: some USB bridges report a short numeric string
    // (e.g. "456") instead of a real model name.  Replace with a generic
    // label derived from the detected disk type so the UI stays readable.
    let model = device.model?.trim() || null
    if (model !== null && /^\d{1,5}$/.test(model)) {
      const diskType = resolveDiskType(device)
      const typeLabel: Record<string, string> = {
        nvme: 'NVMe SSD',
        ssd:  'SATA SSD',
        hdd:  'Hard Disk',
        usb:  'USB Storage',
        other: 'Storage Device',
      }
      model = typeLabel[diskType] ?? 'Storage Device'
    }

    disks.push({
      device: `/dev/${device.name}`,
      name: device.name,
      diskType: resolveDiskType(device),
      model,
      serial: device.serial?.trim() || null,
      sizeBytes,
      usedBytes,
      fsType: device.fstype || null,
      mountPoint: device.mountpoint || null,
      smart,
    })
  }

  return disks
}

// ─── SnapRAID ─────────────────────────────────────────────────────────────────

export function getSnapRaidStatus(): SnapRaidStatus {
  const configured = (() => { try { return existsSync('/etc/snapraid.conf') } catch { return false } })()
  return {
    configured,
    running: snapraidState.running,
    operation: snapraidState.operation,
    progress: snapraidState.progress,
    status: snapraidState.status,
    error: snapraidState.error,
    lastSync: snapraidState.lastSync,
    lastScrub: snapraidState.lastScrub,
  }
}

export function startSnapRaid(operation: 'sync' | 'scrub' | 'fix' | 'check'): void {
  if (snapraidState.running) return

  snapraidState.running = true
  snapraidState.operation = operation
  snapraidState.progress = 0
  snapraidState.status = `Iniciando ${operation}...`
  snapraidState.error = null

  const proc = execa('snapraid', [operation], { shell: false, reject: false })
  snapraidState.process = proc

  // Parse stdout for progress
  if (proc.stdout) {
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const lines = text.split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        snapraidState.status = line.trim()
        // Look for percentage pattern like "42%" or "42.5%"
        const match = line.match(/(\d+(?:\.\d+)?)\s*%/)
        if (match) {
          snapraidState.progress = Math.min(100, parseFloat(match[1]))
        }
      }
    })
  }

  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const lines = text.split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        snapraidState.status = line.trim()
        const match = line.match(/(\d+(?:\.\d+)?)\s*%/)
        if (match) {
          snapraidState.progress = Math.min(100, parseFloat(match[1]))
        }
      }
    })
  }

  proc.then((result) => {
    snapraidState.running = false
    snapraidState.process = null
    snapraidState.progress = 100

    if (result.exitCode !== 0) {
      snapraidState.error = result.stderr?.trim() || `snapraid ${operation} failed`
      snapraidState.status = `Error en ${operation}`
    } else {
      snapraidState.error = null
      snapraidState.status = `${operation} completado`
      const now = Math.floor(Date.now() / 1000)
      if (operation === 'sync') snapraidState.lastSync = now
      if (operation === 'scrub') snapraidState.lastScrub = now
    }

    snapraidState.operation = 'idle'
  }).catch((err: Error) => {
    snapraidState.running = false
    snapraidState.process = null
    snapraidState.operation = 'idle'
    snapraidState.error = err.message
    snapraidState.status = 'Error inesperado'
  })
}

export function stopSnapRaid(): void {
  if (snapraidState.process) {
    snapraidState.process.kill('SIGTERM')
    snapraidState.process = null
    snapraidState.running = false
    snapraidState.operation = 'idle'
    snapraidState.status = 'Detenido manualmente'
  }
}

// ─── MergerFS ─────────────────────────────────────────────────────────────────

async function getDiskUsage(path: string): Promise<{ total: number; used: number } | null> {
  const r = await exec('df', ['--block-size=1', '--output=size,used', path])
  if (r.exitCode !== 0) return null
  const line = r.stdout.trim().split('\n')[1]?.trim()
  if (!line) return null
  const parts = line.split(/\s+/)
  const total = parseInt(parts[0], 10)
  const used = parseInt(parts[1], 10)
  if (isNaN(total) || isNaN(used)) return null
  return { total, used }
}

export async function getMergerFSStatus(): Promise<MergerFSStatus> {
  const defaultResult: MergerFSStatus = {
    mounted: false,
    mountPoint: '/mnt/pool',
    drives: [],
    totalBytes: null,
    usedBytes: null,
  }

  // Find any fuse.mergerfs mount in /proc/mounts (path may differ per installation)
  const mountsResult = await exec('cat', ['/proc/mounts'])
  let detectedMount: string | null = null
  let rawSources: string[] = []

  if (mountsResult.exitCode === 0) {
    for (const line of mountsResult.stdout.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts[2] === 'fuse.mergerfs') {
        detectedMount = parts[1]
        rawSources = parts[0].split(':').filter(s => s.startsWith('/'))
        break
      }
    }
  }

  if (!detectedMount) return defaultResult

  // Scan /mnt/disks/* for actual mounted disks — covers cases where the
  // source in /proc/mounts is a device number (e.g. old v2 format "1:7")
  const scanResult = await exec('find', ['/mnt/disks', '-maxdepth', '1', '-mindepth', '1', '-type', 'd'])
  const scannedPaths = scanResult.exitCode === 0
    ? scanResult.stdout.split('\n').map(s => s.trim()).filter(Boolean)
    : []

  // Merge: prefer rawSources if they're real paths, otherwise use scanned
  const allPaths = rawSources.length > 0 ? rawSources : scannedPaths

  // Build per-disk info with role detection and usage
  const drives: MergerFSDrive[] = []
  let poolTotal = 0
  let poolUsed = 0

  for (const path of allPaths) {
    // Check if this path is actually mounted
    const mountCheck = await exec('mountpoint', ['-q', path])
    if (mountCheck.exitCode !== 0) continue

    const role: MergerFSDrive['role'] = /cache/i.test(path) ? 'cache' : /disk/i.test(path) ? 'data' : 'unknown'
    const usage = await getDiskUsage(path)

    drives.push({
      path,
      role,
      totalBytes: usage?.total ?? null,
      usedBytes: usage?.used ?? null,
    })

    // Only sum data disks for the pool total (not cache, not parity)
    if (role === 'data' && usage) {
      poolTotal += usage.total
      poolUsed += usage.used
    }
  }

  // Fallback: if no data disks found, use the mergerfs mount itself
  let totalBytes: number | null = drives.some(d => d.role === 'data') ? poolTotal : null
  let usedBytes: number | null = drives.some(d => d.role === 'data') ? poolUsed : null

  if (totalBytes === null) {
    const usage = await getDiskUsage(detectedMount)
    if (usage) { totalBytes = usage.total; usedBytes = usage.used }
  }

  return { mounted: true, mountPoint: detectedMount, drives, totalBytes, usedBytes }
}

// Ningún disco de datos debe superar este nivel de llenado durante el drenado.
// Los discos son SMR: llenarlos al tope degrada gravemente su escritura y no
// deja margen anti-fragmentación. Se calcula sobre df "size" (que incluye la
// reserva del 5% de ext4), así que parar en el 90% mantiene ese colchón intacto.
const DRAIN_FILL_LIMIT = 0.90

export async function drainMergerFSCache(): Promise<void> {
  const status = await getMergerFSStatus()
  if (!status.mounted) throw new Error('MergerFS no está montado')

  const cacheDisk = status.drives.find(d => d.role === 'cache')
  if (!cacheDisk) throw new Error('No se detectó ningún disco de caché')

  const dataDisks = status.drives
    .filter(d => d.role === 'data')
    .filter(d => d.totalBytes !== null && d.usedBytes !== null)

  if (dataDisks.length === 0) throw new Error('No se detectaron discos de datos')

  // Presupuesto de bytes que cada disco puede aún aceptar sin superar el límite.
  const budget = new Map<string, number>()
  for (const d of dataDisks) {
    const limit = Math.floor(d.totalBytes! * DRAIN_FILL_LIMIT)
    budget.set(d.path, Math.max(0, limit - d.usedBytes!))
  }

  const cachePrefix = cacheDisk.path.endsWith('/') ? cacheDisk.path : `${cacheDisk.path}/`

  // Listar los archivos de la caché con su tamaño: "<bytes>\t<ruta>".
  const listResult = await exec('find', [
    cacheDisk.path, '-mindepth', '1', '-type', 'f', '-printf', '%s\\t%p\\n',
  ])
  const files = listResult.stdout.split('\n')
    .filter(l => l.includes('\t'))
    .map(l => {
      const tab = l.indexOf('\t')
      return { size: parseInt(l.slice(0, tab), 10), path: l.slice(tab + 1) }
    })
    .filter(f => Number.isFinite(f.size) && f.path.startsWith(cachePrefix))
    // Archivos grandes primero: mejor equilibrio (bin-packing descendente).
    .sort((a, b) => b.size - a.size)

  let lastError: string | null = null

  // Reparto ARCHIVO POR ARCHIVO: cada uno al disco con más presupuesto que aún
  // pueda alojarlo sin pasar del límite. Equilibra y evita llenar un disco.
  for (const file of files) {
    let target: string | null = null
    let bestBudget = -1
    for (const d of dataDisks) {
      const b = budget.get(d.path) ?? 0
      if (b >= file.size && b > bestBudget) {
        bestBudget = b
        target = d.path
      }
    }
    if (!target) {
      lastError = `Sin disco por debajo del ${Math.round(DRAIN_FILL_LIMIT * 100)}% para "${file.path.slice(cachePrefix.length)}"`
      continue
    }

    // rsync -R con "./" preserva la jerarquía relativa (downloads/complete/…).
    const rel = file.path.slice(cachePrefix.length)
    const result = await exec('rsync', [
      '--remove-source-files', '--archive', '--relative',
      `${cachePrefix}./${rel}`, `${target}/`,
    ])
    if (result.exitCode !== 0) {
      lastError = result.stderr || result.stdout
    } else {
      budget.set(target, (budget.get(target) ?? 0) - file.size)
    }
  }

  // Remove empty directories left by --remove-source-files (-depth = bottom-up,
  // so nested empty dirs are deleted before their parents in a single pass).
  await exec('find', [
    cacheDisk.path, '-mindepth', '1', '-depth',
    '-type', 'd', '-empty', '!', '-name', 'lost+found', '-delete',
  ])

  // Si quedan archivos es porque todos los discos alcanzaron el límite del 90%.
  // No es un fallo de datos, pero se informa: hace falta más capacidad.
  const remaining = await exec('find', [
    cacheDisk.path, '-mindepth', '1', '-type', 'f',
  ])
  if (remaining.stdout.trim()) {
    throw new Error(
      `No se movieron todos los archivos: los discos de datos alcanzaron el límite de llenado del ${Math.round(DRAIN_FILL_LIMIT * 100)}%.` +
      (lastError ? ` Detalle: ${lastError}` : '')
    )
  }
}

// ─── Cache drain scheduler ────────────────────────────────────────────────────

let _db: Database | null = null
let _drainConfig: CacheDrainConfig = { mode: 'off', intervalHours: 6, thresholdGB: 50 }
let _drainTimer: ReturnType<typeof setInterval> | null = null
let _lastDrainAt: number | null = null
let _draining = false

export function getCacheDrainStatus(): CacheDrainStatus {
  return { ..._drainConfig, lastDrainAt: _lastDrainAt, draining: _draining }
}

export function initCacheDrainScheduler(db: Database): void {
  _db = db
  const raw = getSetting(db, 'cache_drain_config')
  if (raw) {
    try { _drainConfig = JSON.parse(raw) as CacheDrainConfig } catch { /* use defaults */ }
  }
  _restartDrainTimer()
}

export function setCacheDrainConfig(config: CacheDrainConfig): void {
  _drainConfig = { ...config }
  if (_db) setSetting(_db, 'cache_drain_config', JSON.stringify(config))
  _restartDrainTimer()
}

function _restartDrainTimer(): void {
  if (_drainTimer) { clearInterval(_drainTimer); _drainTimer = null }
  if (_drainConfig.mode === 'off') return
  // Poll every 10 minutes; both time and size conditions are checked each tick
  _drainTimer = setInterval(() => { void _checkAndDrain() }, 10 * 60 * 1000)
}

async function _checkAndDrain(): Promise<void> {
  if (_draining) return
  const { mode, intervalHours, thresholdGB } = _drainConfig
  const now = Date.now()
  let shouldDrain = false

  if (mode === 'time' || mode === 'both') {
    const elapsed = now - (_lastDrainAt ?? 0)
    if (elapsed >= intervalHours * 3_600_000) shouldDrain = true
  }

  if (!shouldDrain && (mode === 'size' || mode === 'both')) {
    try {
      const status = await getMergerFSStatus()
      const cache = status.drives.find(d => d.role === 'cache')
      if (cache?.usedBytes != null && cache.usedBytes >= thresholdGB * 1_073_741_824) {
        shouldDrain = true
      }
    } catch { /* getMergerFSStatus failed — skip this tick */ }
  }

  if (!shouldDrain) return

  _draining = true
  try {
    await drainMergerFSCache()
    _lastDrainAt = Date.now()
  } catch (err) {
    console.error('[cache-drain] auto drain failed:', (err as Error).message)
  } finally {
    _draining = false
  }
}

// ─── Badblocks ────────────────────────────────────────────────────────────────

export function getBadblocksStatus(): BadblocksStatus {
  return {
    running: badblocksState.running,
    device: badblocksState.device,
    progress: badblocksState.progress,
    blocksChecked: badblocksState.blocksChecked,
    badBlocks: badblocksState.badBlocks,
    status: badblocksState.status,
    error: badblocksState.error,
  }
}

export function startBadblocks(device: string, writeMode: boolean): void {
  // Validate device path (extra safety beyond Zod)
  if (!/^\/dev\/[a-z0-9]+$/.test(device)) {
    throw new Error(`Invalid device path: ${device}`)
  }

  if (badblocksState.running) return

  badblocksState.running = true
  badblocksState.device = device
  badblocksState.progress = 0
  badblocksState.blocksChecked = 0
  badblocksState.badBlocks = 0
  badblocksState.status = 'Iniciando badblocks...'
  badblocksState.error = null

  // Use stdbuf -eU to force unbuffered stderr — without it, glibc buffers
  // badblocks' \r progress lines inside the pipe and node never receives them.
  const bbArgs = ['-v', ...(writeMode ? ['-w'] : []), device]
  const proc = execa('stdbuf', ['-e0', 'badblocks', ...bbArgs], { shell: false, reject: false })
  badblocksState.process = proc

  // badblocks writes progress to stderr using \r (carriage return) to update
  // the same line. Example line:
  //   "Checking for bad blocks (read-only test): 12.34% done, 0:01 elapsed. (0/0/0 errors)"
  // or the older block-count format:
  //   "123456 / 976773167, 0 bad blocks found so far."
  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      // Split on both \n and \r to catch in-place progress updates
      const lines = text.split(/[\r\n]+/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        badblocksState.status = trimmed

        // Format 1: "X.XX% done, H:MM elapsed"
        // (emitted via \r, so we must split on \r above)
        const pctMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*%\s*done/)
        if (pctMatch) {
          badblocksState.progress = Math.min(100, parseFloat(pctMatch[1]))
        }

        // Format 2 (older badblocks): "checked / total"
        const progressMatch = trimmed.match(/(\d+)\s*\/\s*(\d+)/)
        if (progressMatch) {
          const checked = parseInt(progressMatch[1], 10)
          const total = parseInt(progressMatch[2], 10)
          badblocksState.blocksChecked = checked
          if (total > 0) {
            badblocksState.progress = Math.min(100, (checked / total) * 100)
          }
        }

        // Bad block count from summary line
        const badMatch = trimmed.match(/(\d+)\s+bad\s+block/i)
        if (badMatch) {
          badblocksState.badBlocks = parseInt(badMatch[1], 10)
        }
      }
    })
  }

  if (proc.stdout) {
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const lines = text.split('\n')
      for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s*$/)
        if (match) {
          badblocksState.badBlocks++
        }
      }
    })
  }

  proc.then((result) => {
    badblocksState.running = false
    badblocksState.process = null
    badblocksState.progress = 100

    if (result.exitCode !== 0) {
      badblocksState.error = result.stderr?.trim() || 'badblocks failed'
      badblocksState.status = 'Error en badblocks'
    } else {
      badblocksState.error = null
      badblocksState.status = `Completado: ${badblocksState.badBlocks} bloques malos encontrados`
    }
  }).catch((err: Error) => {
    badblocksState.running = false
    badblocksState.process = null
    badblocksState.error = err.message
    badblocksState.status = 'Error inesperado'
  })
}

export function stopBadblocks(): void {
  if (badblocksState.process) {
    try {
      badblocksState.process.kill('SIGTERM')
    } catch {
      // Process may have already exited; ignore the error
    }
    badblocksState.process = null
    badblocksState.running = false
    badblocksState.status = 'Detenido manualmente'
  }
}

// ─── Disk I/O metrics ─────────────────────────────────────────────────────────

export interface DiskIoStat {
  diskId: string
  readMBs: number
  writeMBs: number
  ioErrors: number
}

// Module-level snapshot map for delta calculation
const _ioSnapshots = new Map<string, { sectorsRead: number; sectorsWritten: number; ioErrors: number; timestamp: number }>()

function readSysBlockStat(diskId: string): { sectorsRead: number; sectorsWritten: number; ioErrors: number } | null {
  try {
    const raw = readFileSync(`/sys/block/${diskId}/stat`, 'utf8').trim().split(/\s+/)
    return {
      sectorsRead:    parseInt(raw[2] ?? '0') || 0,  // field 2: sectors read
      sectorsWritten: parseInt(raw[6] ?? '0') || 0,  // field 6: sectors written
      ioErrors:       parseInt(raw[9] ?? '0') || 0,  // field 9: I/O errors in-flight
    }
  } catch {
    return null
  }
}

export function getIoStats(diskIds: string[]): DiskIoStat[] {
  const now = Date.now()
  return diskIds.map(diskId => {
    const current = readSysBlockStat(diskId)
    if (!current) return { diskId, readMBs: 0, writeMBs: 0, ioErrors: 0 }

    const prev = _ioSnapshots.get(diskId)
    let readMBs = 0, writeMBs = 0

    if (prev) {
      const elapsedS = (now - prev.timestamp) / 1000
      if (elapsedS > 0) {
        readMBs  = ((current.sectorsRead    - prev.sectorsRead)    * 512) / elapsedS / (1024 * 1024)
        writeMBs = ((current.sectorsWritten - prev.sectorsWritten) * 512) / elapsedS / (1024 * 1024)
        if (readMBs  < 0) readMBs  = 0
        if (writeMBs < 0) writeMBs = 0
      }
    }

    _ioSnapshots.set(diskId, { ...current, timestamp: now })

    return {
      diskId,
      readMBs:  parseFloat(readMBs.toFixed(2)),
      writeMBs: parseFloat(writeMBs.toFixed(2)),
      ioErrors: current.ioErrors,
    }
  })
}
