import { execa } from 'execa'
import type { ResultPromise } from 'execa'
import { readFile } from 'node:fs/promises'
import { normalize } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { exec } from '../lib/exec.js'
import type { Container, ComposeStack, ComposeProgress } from '@homenas/shared'

// Cache: only check `which docker` once per process. Docker presence
// doesn't change at runtime (install requires service restart anyway).
let _dockerAvailable: boolean | null = null

export async function ensureDockerAvailable(): Promise<void> {
  if (_dockerAvailable === null) {
    const r = await exec('which', ['docker'])
    _dockerAvailable = r.exitCode === 0 && r.stdout.trim() !== ''
  }
  if (!_dockerAvailable) {
    throw new Error(
      'Docker no está instalado en este sistema. ' +
      'Instálalo con: curl -fsSL https://get.docker.com | sudo sh && sudo systemctl enable --now docker'
    )
  }
}

// ─── Compose YAML validation ──────────────────────────────────────────────────

const ALLOWED_VOLUME_PREFIXES = [
  '/mnt/',
  '/opt/stacks/',
  '/opt/homenas-v3/',
  '/tmp/',
]

// Paths that are always blocked regardless of prefix matching
const BLOCKED_PATHS = ['/', '/etc', '/root', '/boot', '/sys', '/proc', '/run', '/usr', '/bin', '/sbin', '/lib']

const BLOCKED_CAPABILITIES = ['SYS_ADMIN', 'SYS_PTRACE', 'NET_ADMIN', 'ALL']

export async function validateComposeFile(composePath: string): Promise<void> {
  let raw: string
  try {
    raw = await readFile(composePath, 'utf-8')
  } catch {
    throw new Error(`Cannot read compose file: ${composePath}`)
  }

  let doc: Record<string, unknown>
  try {
    doc = parseYaml(raw) as Record<string, unknown>
  } catch (e) {
    throw new Error(`Invalid YAML in compose file: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!doc || typeof doc !== 'object') {
    throw new Error('Compose file must be a YAML object')
  }

  const services = doc['services'] as Record<string, unknown> | undefined
  if (!services || typeof services !== 'object') return

  for (const [serviceName, service] of Object.entries(services)) {
    if (!service || typeof service !== 'object') continue
    const svc = service as Record<string, unknown>

    // Block privileged containers
    if (svc['privileged'] === true) {
      throw new Error(`Service "${serviceName}" uses privileged mode — not allowed`)
    }

    // Block host namespace sharing — allows container escape to the host
    if (svc['network_mode'] === 'host') {
      throw new Error(`Service "${serviceName}" uses network_mode: host — not allowed`)
    }
    if (svc['pid'] === 'host') {
      throw new Error(`Service "${serviceName}" uses pid: host — not allowed`)
    }
    if (svc['userns_mode'] === 'host') {
      throw new Error(`Service "${serviceName}" uses userns_mode: host — not allowed`)
    }
    if (svc['ipc'] === 'host') {
      throw new Error(`Service "${serviceName}" uses ipc: host — not allowed`)
    }

    // Block dangerous capabilities
    const capAdd = svc['cap_add']
    if (Array.isArray(capAdd)) {
      for (const cap of capAdd) {
        if (typeof cap === 'string' && BLOCKED_CAPABILITIES.includes(cap.toUpperCase())) {
          throw new Error(`Service "${serviceName}" adds dangerous capability: ${cap}`)
        }
      }
    }

    // Validate volume mounts
    const volumes = svc['volumes']
    if (Array.isArray(volumes)) {
      for (const vol of volumes) {
        // Volumes can be strings ("host:container") or objects ({source, target})
        let hostPath: string | null = null

        if (typeof vol === 'string') {
          const parts = vol.split(':')
          // Named volumes (no leading slash) are fine — skip
          if (parts[0] && parts[0].startsWith('/')) {
            hostPath = parts[0]
          }
        } else if (vol && typeof vol === 'object') {
          const v = vol as Record<string, unknown>
          if (typeof v['source'] === 'string' && v['source'].startsWith('/')) {
            hostPath = v['source']
          }
        }

        if (!hostPath) continue

        const normalized = normalize(hostPath)

        // Block exact dangerous paths
        if (BLOCKED_PATHS.includes(normalized)) {
          throw new Error(`Service "${serviceName}" mounts blocked path: ${normalized}`)
        }

        // Must start with an allowed prefix
        const allowed = ALLOWED_VOLUME_PREFIXES.some(p => normalized.startsWith(p))
        if (!allowed) {
          throw new Error(
            `Service "${serviceName}" mounts disallowed path "${normalized}". ` +
            `Allowed: ${ALLOWED_VOLUME_PREFIXES.join(', ')}`
          )
        }
      }
    }
  }
}

// ─── Module-level state ───────────────────────────────────────────────────────

interface ComposeState {
  running: boolean
  action: string
  output: string[]
  error: string | null
  process: ResultPromise | null
}

const composeState: ComposeState = {
  running: false,
  action: '',
  output: [],
  error: null,
  process: null,
}

// ─── Port parsing ─────────────────────────────────────────────────────────────

interface ParsedPort {
  hostPort: number | null
  containerPort: number
  protocol: string
}

// Parse docker Ports string like "0.0.0.0:8080->80/tcp, :::8080->80/tcp"
function parsePorts(portsStr: string): ParsedPort[] {
  if (!portsStr) return []

  const ports: ParsedPort[] = []
  const seen = new Set<string>()

  const entries = portsStr.split(',').map((s) => s.trim())
  for (const entry of entries) {
    if (!entry) continue

    // Format: "0.0.0.0:8080->80/tcp" or ":::8080->80/tcp" or "80/tcp"
    const arrowMatch = entry.match(/(?:\S+:)?(\d+)->(\d+)\/(\w+)/)
    if (arrowMatch) {
      const hostPort = parseInt(arrowMatch[1], 10)
      const containerPort = parseInt(arrowMatch[2], 10)
      const protocol = arrowMatch[3]
      const key = `${hostPort}:${containerPort}/${protocol}`
      if (!seen.has(key)) {
        seen.add(key)
        ports.push({ hostPort, containerPort, protocol })
      }
      continue
    }

    // Format: "80/tcp" (no host binding)
    const simpleMatch = entry.match(/^(\d+)\/(\w+)$/)
    if (simpleMatch) {
      const containerPort = parseInt(simpleMatch[1], 10)
      const protocol = simpleMatch[2]
      const key = `null:${containerPort}/${protocol}`
      if (!seen.has(key)) {
        seen.add(key)
        ports.push({ hostPort: null, containerPort, protocol })
      }
    }
  }

  return ports
}

// ─── Docker ps JSON line format ───────────────────────────────────────────────

interface DockerPsLine {
  ID: string
  Names: string
  Image: string
  Status: string
  State: string
  CreatedAt: string
  Ports: string
}

interface DockerStatsLine {
  ID: string
  CPUPerc: string   // "1.23%"
  MemUsage: string  // "100MiB / 8GiB"
}

function parsePercent(s: string): number | null {
  if (!s) return null
  const match = s.match(/([\d.]+)%/)
  if (!match) return null
  const v = parseFloat(match[1])
  return isNaN(v) ? null : v
}

function parseMemBytes(s: string): { usage: number | null; limit: number | null } {
  // "100MiB / 8GiB" or "100MB / 8GB"
  const parts = s.split('/')
  return {
    usage: parseMemValue(parts[0]?.trim() ?? ''),
    limit: parseMemValue(parts[1]?.trim() ?? ''),
  }
}

function parseMemValue(s: string): number | null {
  if (!s || s === '0B') return null
  const units: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  }
  const match = s.match(/^([\d.]+)\s*([A-Za-z]+)$/)
  if (!match) return null
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multiplier = units[unit] ?? 1
  const result = Math.round(value * multiplier)
  return isNaN(result) ? null : result
}

// ─── listContainers ───────────────────────────────────────────────────────────

export async function listContainers(): Promise<Container[]> {
  // Docker missing → empty list (UI shows "No containers" instead of 500).
  try { await ensureDockerAvailable() } catch { return [] }

  const result = await exec('docker', [
    'ps', '-a',
    '--format', '{{json .}}',
  ])

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return []
  }

  const containers: Container[] = []
  const lines = result.stdout.trim().split('\n')

  for (const line of lines) {
    if (!line.trim()) continue
    let row: DockerPsLine
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }

    // Parse created timestamp — docker CreatedAt is like "2024-01-15 10:30:00 +0000 UTC"
    let created = 0
    if (row.CreatedAt) {
      const ts = Date.parse(row.CreatedAt)
      if (!isNaN(ts)) created = Math.floor(ts / 1000)
    }

    const ports = parsePorts(row.Ports ?? '')
    const state = (row.State ?? '').toLowerCase()
    const status = state || ((row.Status ?? '').toLowerCase().split(' ')[0] ?? 'unknown')

    // Get stats only for running containers
    let cpuPercent: number | null = null
    let memUsageBytes: number | null = null
    let memLimitBytes: number | null = null

    if (state === 'running') {
      const statsResult = await exec('docker', [
        'stats', '--no-stream', '--format', '{{json .}}', row.ID,
      ])
      if (statsResult.exitCode === 0 && statsResult.stdout.trim()) {
        try {
          const stats: DockerStatsLine = JSON.parse(statsResult.stdout.trim())
          cpuPercent = parsePercent(stats.CPUPerc)
          const mem = parseMemBytes(stats.MemUsage ?? '')
          memUsageBytes = mem.usage
          memLimitBytes = mem.limit
        } catch {
          // ignore parse errors
        }
      }
    }

    // Clean name — docker ps includes leading slash sometimes
    const name = (row.Names ?? '').replace(/^\//, '')

    // Get environment variables — filter out system/noise vars not useful to the user
    const ENV_SKIP = /^(PATH|HOME|TERM|PS1|SHELL|HOSTNAME|USER|VIRTUAL_ENV|TZ|S6_|XDG_|LSIO_|LANG|LANGUAGE|LC_)/
    let envVars: string[] = []
    const inspectResult = await exec('docker', [
      'inspect', row.ID, '--format', '{{json .Config.Env}}',
    ])
    if (inspectResult.exitCode === 0 && inspectResult.stdout.trim()) {
      try {
        const parsed = JSON.parse(inspectResult.stdout.trim())
        if (Array.isArray(parsed)) {
          envVars = parsed
            .filter((v): v is string => typeof v === 'string')
            .filter((v) => !ENV_SKIP.test(v.split('=')[0] ?? ''))
        }
      } catch {
        // ignore parse errors
      }
    }

    containers.push({
      id: row.ID,
      name,
      image: row.Image ?? '',
      status,
      state: row.State ?? '',
      created,
      ports,
      cpuPercent,
      memUsageBytes,
      memLimitBytes,
      envVars,
    })
  }

  return containers
}

// ─── containerAction ──────────────────────────────────────────────────────────

export async function containerAction(containerId: string, action: string): Promise<void> {
  await ensureDockerAvailable()
  // Defensive validation — schema already checks, but guard at service layer too
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(containerId)) {
    throw new Error('Invalid container ID format')
  }

  let result

  if (action === 'remove') {
    result = await exec('docker', ['rm', '-f', containerId])
  } else {
    result = await exec('docker', [action, containerId])
  }

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `docker ${action} failed`)
  }
}

// ─── getContainerLogs ─────────────────────────────────────────────────────────

export async function getContainerLogs(containerId: string, lines: number): Promise<string> {
  await ensureDockerAvailable()
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(containerId)) {
    throw new Error('Invalid container ID format')
  }

  const result = await exec('docker', [
    'logs', '--tail', String(lines), containerId,
  ])
  // Return stdout + stderr combined (docker logs mixes them)
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n')
  return combined
}

// ─── listComposeStacks ────────────────────────────────────────────────────────

const STACKS_DIR = '/opt/stacks'

interface ComposePsLine {
  Name?: string
  Service?: string
  State?: string
  Status?: string
}

export async function listComposeStacks(): Promise<ComposeStack[]> {
  const stacks: ComposeStack[] = []

  // Docker missing → empty list (UI shows "No stacks").
  try { await ensureDockerAvailable() } catch { return stacks }

  // Check if /opt/stacks exists
  const checkDir = await exec('test', ['-d', STACKS_DIR])
  if (checkDir.exitCode !== 0) return stacks

  // List subdirectories
  const lsResult = await exec('find', [
    STACKS_DIR, '-maxdepth', '1', '-mindepth', '1', '-type', 'd',
  ])
  if (lsResult.exitCode !== 0 || !lsResult.stdout.trim()) return stacks

  const dirs = lsResult.stdout.trim().split('\n').filter(Boolean)

  for (const dir of dirs) {
    const composeFile = `${dir}/docker-compose.yml`
    const altComposeFile = `${dir}/docker-compose.yaml`

    // Check if compose file exists
    const checkFile = await exec('test', ['-f', composeFile])
    const checkAlt = checkFile.exitCode !== 0
      ? await exec('test', ['-f', altComposeFile])
      : { exitCode: 1 }

    const composePath = checkFile.exitCode === 0
      ? composeFile
      : checkAlt.exitCode === 0
        ? altComposeFile
        : null

    if (!composePath) continue

    const name = dir.split('/').pop() ?? dir
    const services: string[] = []
    let containerCount = 0
    let runningCount = 0
    let stackStatus: ComposeStack['status'] = 'unknown'

    // Run docker compose ps to get status
    const psResult = await exec('docker', [
      'compose', '-f', composePath, 'ps', '--format', 'json',
    ])

    if (psResult.exitCode === 0 && psResult.stdout.trim()) {
      // docker compose ps --format json outputs one JSON object per line OR a JSON array
      const raw = psResult.stdout.trim()
      let rows: ComposePsLine[] = []

      if (raw.startsWith('[')) {
        try { rows = JSON.parse(raw) } catch { rows = [] }
      } else {
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try { rows.push(JSON.parse(line)) } catch { /* skip */ }
        }
      }

      containerCount = rows.length

      for (const row of rows) {
        const svc = row.Service ?? row.Name ?? ''
        if (svc && !services.includes(svc)) services.push(svc)
        const state = (row.State ?? row.Status ?? '').toLowerCase()
        if (state.includes('running') || state === 'running') runningCount++
      }

      if (containerCount === 0) {
        stackStatus = 'stopped'
      } else if (runningCount === containerCount) {
        stackStatus = 'running'
      } else if (runningCount > 0) {
        stackStatus = 'partial'
      } else {
        stackStatus = 'stopped'
      }
    } else {
      // ps failed — try to determine from config
      stackStatus = 'unknown'
    }

    stacks.push({
      name,
      path: dir,
      status: stackStatus,
      services,
      containerCount,
      runningCount,
    })
  }

  return stacks
}

// ─── composeAction ────────────────────────────────────────────────────────────

export async function composeAction(path: string, action: string): Promise<{ started: true }> {
  await ensureDockerAvailable()
  if (composeState.running) {
    throw new Error('A compose operation is already running')
  }

  // Validate path — must be within /opt/stacks, no traversal
  if (path.includes('..') || (!path.startsWith('/opt/stacks/') && path !== '/opt/stacks')) {
    throw new Error('Path must be within /opt/stacks')
  }

  const composePath = path.endsWith('.yml') || path.endsWith('.yaml')
    ? path
    : `${path}/docker-compose.yml`

  // Validate compose file contents before executing (only for 'up')
  if (action === 'up') {
    await validateComposeFile(composePath)
  }

  composeState.running = true
  composeState.action = action
  composeState.output = []
  composeState.error = null

  let args: string[]
  if (action === 'up') {
    args = ['compose', '-f', composePath, 'up', '-d']
  } else if (action === 'down') {
    args = ['compose', '-f', composePath, 'down']
  } else if (action === 'pull') {
    args = ['compose', '-f', composePath, 'pull']
  } else if (action === 'restart') {
    args = ['compose', '-f', composePath, 'restart']
  } else {
    composeState.running = false
    throw new Error(`Unknown action: ${action}`)
  }

  const proc = execa('docker', args, { shell: false, reject: false })
  composeState.process = proc

  const appendOutput = (text: string) => {
    const lines = text.split('\n')
    for (const line of lines) {
      if (line.trim()) composeState.output.push(line)
    }
  }

  if (proc.stdout) {
    proc.stdout.on('data', (chunk: Buffer) => appendOutput(chunk.toString()))
  }
  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => appendOutput(chunk.toString()))
  }

  proc.then((result) => {
    composeState.running = false
    composeState.process = null
    if (result.exitCode !== 0) {
      composeState.error = result.stderr?.trim() || `docker compose ${action} failed`
    }
  }).catch((err: Error) => {
    composeState.running = false
    composeState.process = null
    composeState.error = err.message
  })

  return { started: true }
}

// ─── getComposeProgress ───────────────────────────────────────────────────────

export function getComposeProgress(): ComposeProgress {
  return {
    running: composeState.running,
    action: composeState.action,
    output: [...composeState.output],
    error: composeState.error,
  }
}
