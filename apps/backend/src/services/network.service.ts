import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { normalize as normalizePath } from 'node:path'
import { execa } from 'execa'
import { exec, execWithInput, writeFileAsRoot } from '../lib/exec.js'
import type {
  NetworkInterface,
  WireguardStatus,
  WireguardPeer,
  AddWireguardPeerInput,
  WireguardInitInput,
  DdnsStatus,
  SambaShare,
  CreateSambaShareInput,
  UpdateSambaShareInput,
  SambaSession,
  NfsExport,
  CreateNfsExportInput,
  UpdateNfsExportInput,
  NfsStatus,
} from '@homenas/shared'
import type { Database } from 'better-sqlite3'

/**
 * Reject values that could inject extra lines/directives into line-oriented
 * config files (smb.conf, /etc/exports). A newline/CR/NUL in a user field lets
 * that field become an additional directive — e.g. a Samba `root preexec = ...`
 * (command exec as root) or an extra `/  *(rw,no_root_squash)` export of the
 * filesystem root. Call on every user-supplied field before writing it out.
 */
function assertConfigSafe(value: string, field: string): void {
  if (/[\r\n\x00]/.test(value)) {
    throw new Error(`Invalid ${field}: control characters are not allowed`)
  }
}

// ─── ip addr JSON types ────────────────────────────────────────────────────────

interface IpAddrInfo {
  family: string
  local: string
  prefixlen: number
  scope: string
}

interface IpAddrEntry {
  ifname: string
  flags: string[]
  address?: string
  addr_info: IpAddrInfo[]
}

interface IpLinkStats {
  rx_bytes: number
  tx_bytes: number
}

interface IpLinkEntry {
  ifname: string
  stats64: IpLinkStats
}

// ─── listInterfaces ───────────────────────────────────────────────────────────

export async function listInterfaces(): Promise<NetworkInterface[]> {
  // Get address information
  const addrResult = await exec('ip', ['-j', 'addr'])
  if (addrResult.exitCode !== 0 || !addrResult.stdout) return []

  let addrData: IpAddrEntry[] = []
  try {
    addrData = JSON.parse(addrResult.stdout)
  } catch {
    return []
  }

  // Get stats (rx/tx bytes)
  const statsResult = await exec('ip', ['-j', '-s', 'link'])
  let statsMap: Map<string, IpLinkStats> = new Map()

  if (statsResult.exitCode === 0 && statsResult.stdout) {
    try {
      const statsData: IpLinkEntry[] = JSON.parse(statsResult.stdout)
      for (const entry of statsData) {
        if (entry.stats64) {
          statsMap.set(entry.ifname, entry.stats64)
        }
      }
    } catch {
      // graceful fallback — stats stay empty
    }
  }

  // Filter out virtual/Docker interfaces — only show physical ones
  const VIRTUAL_IFACE = /^(docker\d*|veth|br-|virbr|lo$|bond\d|dummy|tun\d|tap\d)/
  const physicalIfaces = addrData.filter((iface) => !VIRTUAL_IFACE.test(iface.ifname))

  const interfaces: NetworkInterface[] = []

  for (const iface of physicalIfaces) {
    const ipv4 = iface.addr_info.find((a) => a.family === 'inet')?.local ?? null
    const ipv6 = iface.addr_info.find((a) => a.family === 'inet6' && a.scope !== 'link')?.local ?? null

    const stats = statsMap.get(iface.ifname)
    const isUp = iface.flags?.includes('UP') ?? false

    // Try ethtool for speed (graceful fallback)
    let speed: string | null = null
    const ethtoolResult = await exec('ethtool', [iface.ifname])
    if (ethtoolResult.exitCode === 0) {
      const speedMatch = ethtoolResult.stdout.match(/Speed:\s*(\S+)/)
      if (speedMatch) speed = speedMatch[1]
    }

    interfaces.push({
      name: iface.ifname,
      ipv4,
      ipv6,
      mac: iface.address ?? null,
      isUp,
      speed,
      rxBytes: stats?.rx_bytes ?? 0,
      txBytes: stats?.tx_bytes ?? 0,
    })
  }

  return interfaces
}

// ─── WireGuard helpers ────────────────────────────────────────────────────────

const WG0_CONF = '/etc/wireguard/wg0.conf'

/** Parse wg0.conf and return the raw text */
function readWg0Conf(): string {
  try {
    return readFileSync(WG0_CONF, 'utf-8')
  } catch {
    return ''
  }
}

/** Read peer metadata stored as comments in wg0.conf: # Name = ... */
function parsePeerNames(conf: string): Map<string, string> {
  const map = new Map<string, string>()
  const peerBlocks = conf.split(/^\[Peer\]/m).slice(1)
  for (const block of peerBlocks) {
    const nameMatch = block.match(/^#\s*Name\s*=\s*(.+)$/m)
    const pkMatch = block.match(/^PublicKey\s*=\s*(.+)$/m)
    if (nameMatch && pkMatch) {
      map.set(pkMatch[1].trim(), nameMatch[1].trim())
    }
  }
  return map
}

/** Collect all peer AllowedIPs from wg0.conf to find next free IP */
function usedPeerIps(conf: string): Set<string> {
  const used = new Set<string>()
  const matches = conf.matchAll(/^AllowedIPs\s*=\s*(.+)$/gm)
  for (const m of matches) {
    const ip = m[1].trim().split('/')[0]
    if (ip) used.add(ip)
  }
  return used
}

/** Find the lowest free 10.0.0.x (x: 2-254) not already in wg0.conf */
function nextPeerIp(conf: string): string {
  const used = usedPeerIps(conf)
  for (let i = 2; i <= 254; i++) {
    const candidate = `10.0.0.${i}`
    if (!used.has(candidate)) return candidate
  }
  throw new Error('No free IP available in 10.0.0.x/24 range')
}

// ─── installWireguard ─────────────────────────────────────────────────────────

export async function installWireguard(): Promise<{ output: string }> {
  const result = await exec('apt-get', ['install', '-y', 'wireguard', 'wireguard-tools', 'qrencode'])
  if (result.exitCode !== 0) {
    throw new Error(`apt-get install failed: ${result.stderr}`)
  }
  return { output: result.stdout + result.stderr }
}

// ─── initWireguard ────────────────────────────────────────────────────────────

export async function initWireguard(input: WireguardInitInput): Promise<void> {
  const { port, dns } = input

  // Generate server private key
  const privResult = await exec('wg', ['genkey'])
  if (privResult.exitCode !== 0) throw new Error('Failed to generate server private key')
  const serverPrivKey = privResult.stdout.trim()

  // Derive server public key
  const pubResult = await execWithInput('wg', ['pubkey'], serverPrivKey)
  if (pubResult.exitCode !== 0) throw new Error(`Failed to derive server public key: ${pubResult.stderr}`)
  const serverPubKey = pubResult.stdout.trim()

  // Build wg0.conf
  const conf = `[Interface]
# Server private key
PrivateKey = ${serverPrivKey}
Address = 10.0.0.1/24
ListenPort = ${port}
DNS = ${dns}

# PostUp/PostDown for NAT (adjust interface name as needed)
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
# ServerPublicKey = ${serverPubKey}
`

  // /etc/wireguard is root-owned — mkdirSync would EACCES from the homenas
  // user. Use exec which routes through sudo, then chmod 700 for the dir.
  if (!existsSync('/etc/wireguard')) {
    const mk = await exec('mkdir', ['-p', '-m', '700', '/etc/wireguard'])
    if (mk.exitCode !== 0) throw new Error(`Failed to create /etc/wireguard: ${mk.stderr}`)
  }

  await writeFileAsRoot(WG0_CONF, conf, 0o600)
}

// ─── startWireguard / stopWireguard / restartWireguard ───────────────────────

export async function startWireguard(): Promise<void> {
  const r = await exec('systemctl', ['start', 'wg-quick@wg0'])
  if (r.exitCode !== 0) throw new Error(`Failed to start wg-quick@wg0: ${r.stderr}`)
}

export async function stopWireguard(): Promise<void> {
  const r = await exec('systemctl', ['stop', 'wg-quick@wg0'])
  if (r.exitCode !== 0) throw new Error(`Failed to stop wg-quick@wg0: ${r.stderr}`)
}

export async function restartWireguard(): Promise<void> {
  const r = await exec('systemctl', ['restart', 'wg-quick@wg0'])
  if (r.exitCode !== 0) throw new Error(`Failed to restart wg-quick@wg0: ${r.stderr}`)
}

// ─── getWireguardStatus ───────────────────────────────────────────────────────

export async function getWireguardStatus(): Promise<WireguardStatus> {
  const notInstalled: WireguardStatus = {
    installed: false,
    active: false,
    interface: 'wg0',
    listenPort: null,
    publicKey: null,
    serverIp: null,
    peers: [],
  }

  // Check if wg is installed
  const whichResult = await exec('which', ['wg'])
  if (whichResult.exitCode !== 0) return notInstalled

  // Check if wg0.conf exists — installed but not configured
  const confExists = existsSync(WG0_CONF)

  // Get server IP from wg0.conf [Interface] Address
  let serverIp: string | null = null
  if (confExists) {
    const conf = readWg0Conf()
    const addrMatch = conf.match(/^Address\s*=\s*(.+)$/m)
    if (addrMatch) serverIp = addrMatch[1].trim().split('/')[0]
  }

  // Try to read peer names from conf
  const peerNamesMap = confExists ? parsePeerNames(readWg0Conf()) : new Map<string, string>()

  // Get dump — first line is interface, rest are peers
  const dumpResult = await exec('wg', ['show', 'wg0', 'dump'])
  if (dumpResult.exitCode !== 0 || !dumpResult.stdout.trim()) {
    // Installed but not active — extract public key from conf comment if available
    let publicKey: string | null = null
    if (confExists) {
      const conf = readWg0Conf()
      const pkMatch = conf.match(/^#\s*ServerPublicKey\s*=\s*(.+)$/m)
      if (pkMatch) publicKey = pkMatch[1].trim()
    }
    return { ...notInstalled, installed: true, serverIp, publicKey }
  }

  const lines = dumpResult.stdout.trim().split('\n').filter(Boolean)
  if (lines.length === 0) return { ...notInstalled, installed: true, serverIp }

  // First line: private_key, public_key, listen_port, fwmark
  const ifaceLine = lines[0].split('\t')
  const publicKey = ifaceLine[1] ?? null
  const listenPortRaw = ifaceLine[2] ? parseInt(ifaceLine[2], 10) : null
  const listenPort = listenPortRaw !== null && !isNaN(listenPortRaw) ? listenPortRaw : null

  // Remaining lines are peers:
  // public_key, preshared_key, endpoint, allowed_ips, last_handshake, transfer_rx, transfer_tx, persistent_keepalive
  const peers: WireguardPeer[] = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (parts.length < 7) continue
    const peerPublicKey = parts[0]
    const peerPresharedKey = parts[1] && parts[1] !== '(none)' ? parts[1] : null
    const endpoint = parts[2] && parts[2] !== '(none)' ? parts[2] : null
    const allowedIPs = parts[3] ?? ''
    const lastHandshakeRaw = parseInt(parts[4], 10)
    const lastHandshake = isNaN(lastHandshakeRaw) || lastHandshakeRaw === 0 ? null : lastHandshakeRaw
    const transferRx = parseInt(parts[5], 10) || 0
    const transferTx = parseInt(parts[6], 10) || 0

    peers.push({
      name: peerNamesMap.get(peerPublicKey) ?? peerPublicKey.slice(0, 8),
      publicKey: peerPublicKey,
      allowedIPs,
      endpoint,
      lastHandshake,
      transferRx,
      transferTx,
      presharedKey: peerPresharedKey,
    })
  }

  return {
    installed: true,
    active: true,
    interface: 'wg0',
    listenPort,
    publicKey,
    serverIp,
    peers,
  }
}

// ─── addWireguardPeer ─────────────────────────────────────────────────────────

const MAX_WG_PEERS = 100

export async function addWireguardPeer(
  input: AddWireguardPeerInput
): Promise<{ config: string; qrCode: string }> {
  const conf = readWg0Conf()

  // Enforce peer limit
  const currentPeerCount = (conf.match(/^\[Peer\]/gm) ?? []).length
  if (currentPeerCount >= MAX_WG_PEERS) {
    throw new Error(`WireGuard peer limit reached (max ${MAX_WG_PEERS})`)
  }

  // Assign free IP
  const peerIp = nextPeerIp(conf)
  const peerAllowedIPs = `${peerIp}/32`

  // Generate client private key
  const privKeyResult = await exec('wg', ['genkey'])
  if (privKeyResult.exitCode !== 0) throw new Error('Failed to generate private key')
  const clientPrivKey = privKeyResult.stdout.trim()

  // Derive client public key — pipe private key via stdin
  const pubKeyResult = await execa('wg', ['pubkey'], { input: clientPrivKey, shell: false, reject: false })
  if (pubKeyResult.exitCode !== 0) throw new Error(`Failed to derive public key: ${pubKeyResult.stderr}`)
  const clientPubKey = pubKeyResult.stdout.trim()

  // Optionally generate preshared key
  let presharedKey: string | null = null
  if (input.presharedKey) {
    const pskResult = await exec('wg', ['genpsk'])
    if (pskResult.exitCode === 0) {
      presharedKey = pskResult.stdout.trim()
    }
  }

  // Get server's public key and listen port from live wg show (or conf comment)
  let serverPublicKey = ''
  let serverListenPort = '51820'

  const showDumpResult = await exec('wg', ['show', 'wg0', 'dump'])
  if (showDumpResult.exitCode === 0 && showDumpResult.stdout.trim()) {
    const firstLine = showDumpResult.stdout.trim().split('\n')[0]?.split('\t')
    serverPublicKey = firstLine?.[1] ?? ''
    serverListenPort = firstLine?.[2] ?? '51820'
  } else {
    // wg0 not running yet — read from conf comment
    const pkMatch = conf.match(/^#\s*ServerPublicKey\s*=\s*(.+)$/m)
    const portMatch = conf.match(/^ListenPort\s*=\s*(\d+)$/m)
    if (pkMatch) serverPublicKey = pkMatch[1].trim()
    if (portMatch) serverListenPort = portMatch[1].trim()
  }

  // Get server DNS from conf
  let serverDns = '1.1.1.1'
  const dnsMatch = conf.match(/^DNS\s*=\s*(.+)$/m)
  if (dnsMatch) serverDns = dnsMatch[1].trim()

  // Build new [Peer] block to append to wg0.conf
  let peerBlock = `\n[Peer]\n# Name = ${input.name}\nPublicKey = ${clientPubKey}\nAllowedIPs = ${peerAllowedIPs}\n`
  if (presharedKey) {
    peerBlock += `PresharedKey = ${presharedKey}\n`
  }

  const newConf = conf + peerBlock
  await writeFileAsRoot(WG0_CONF, newConf, 0o600)

  // Sync running wg interface if active
  const syncResult = await exec('wg', ['syncconf', 'wg0', WG0_CONF])
  // syncconf may fail if wg0 is not up — that is acceptable

  // Build client .conf text
  const serverHost = process.env.WG_SERVER_HOST ?? 'your-server-ip'
  let configText = `[Interface]
PrivateKey = ${clientPrivKey}
Address = ${peerAllowedIPs}
DNS = ${serverDns}

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${serverHost}:${serverListenPort}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`

  if (presharedKey) {
    configText += `\nPresharedKey = ${presharedKey}`
  }

  // Generate QR code as PNG base64
  let qrCode = ''
  try {
    const qrResult = await execa('qrencode', ['-t', 'PNG', '-o', '-', configText], {
      shell: false,
      reject: false,
      encoding: 'buffer',
    })
    if (qrResult.exitCode === 0 && qrResult.stdout) {
      qrCode = Buffer.from(qrResult.stdout).toString('base64')
    }
  } catch {
    // qrencode not available — skip QR
  }

  // Store config for later retrieval (keyed by clientPubKey, stored in wg0.conf comments is not ideal;
  // we write a sidecar file per peer in /etc/wireguard/peers/)
  try {
    const peersDir = '/etc/wireguard/peers'
    if (!existsSync(peersDir)) mkdirSync(peersDir, { recursive: true, mode: 0o700 })
    const safeKey = clientPubKey.replace(/[^a-zA-Z0-9+/=]/g, '_')
    await writeFileAsRoot(`${peersDir}/${safeKey}.conf`, configText, 0o600)
  } catch {
    // graceful — peer config saved in return value anyway
  }

  void syncResult // suppress unused warning

  return { config: configText, qrCode }
}

// ─── removeWireguardPeer ──────────────────────────────────────────────────────

export async function removeWireguardPeer(publicKey: string): Promise<void> {
  // Remove from running interface (graceful if not active)
  await exec('wg', ['set', 'wg0', 'peer', publicKey, 'remove'])

  // Remove [Peer] block from wg0.conf
  const conf = readWg0Conf()
  if (conf) {
    // Split on [Peer] blocks and filter out the one matching this publicKey
    const sections = conf.split(/(?=^\[Peer\])/m)
    const filtered = sections.filter((section) => {
      if (!section.startsWith('[Peer]')) return true
      return !section.includes(publicKey)
    })
    await writeFileAsRoot(WG0_CONF, filtered.join(''), 0o600)

    // Sync if active
    await exec('wg', ['syncconf', 'wg0', WG0_CONF])
  }

  // Remove sidecar config if exists
  try {
    const safeKey = publicKey.replace(/[^a-zA-Z0-9+/=]/g, '_')
    const { unlinkSync } = await import('node:fs')
    const sidecar = `/etc/wireguard/peers/${safeKey}.conf`
    if (existsSync(sidecar)) unlinkSync(sidecar)
  } catch {
    // graceful
  }
}

// ─── getPeerConfig ────────────────────────────────────────────────────────────

export async function getPeerConfig(publicKey: string): Promise<{ config: string; qrCode: string }> {
  const safeKey = publicKey.replace(/[^a-zA-Z0-9+/=]/g, '_')
  const sidecar = `/etc/wireguard/peers/${safeKey}.conf`

  let config = ''
  if (existsSync(sidecar)) {
    config = readFileSync(sidecar, 'utf-8')
  } else {
    throw new Error(`Peer config not found for key: ${publicKey.slice(0, 16)}...`)
  }

  let qrCode = ''
  try {
    const qrResult = await execa('qrencode', ['-t', 'PNG', '-o', '-', config], {
      shell: false,
      reject: false,
      encoding: 'buffer',
    })
    if (qrResult.exitCode === 0 && qrResult.stdout) {
      qrCode = Buffer.from(qrResult.stdout).toString('base64')
    }
  } catch {
    // qrencode not available
  }

  return { config, qrCode }
}

// ─── getDdnsStatus ────────────────────────────────────────────────────────────

interface DdnsConfig {
  enabled?: boolean
  provider?: string
  domain?: string
  lastUpdate?: number
  lastIp?: string
  status?: string
}

export async function getDdnsStatus(db: Database): Promise<DdnsStatus> {
  const defaultStatus: DdnsStatus = {
    enabled: false,
    provider: null,
    domain: null,
    lastUpdate: null,
    lastIp: null,
    status: 'not_configured',
  }

  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ddns_config') as
      | { value: string }
      | undefined
    if (!row) return defaultStatus

    const config: DdnsConfig = JSON.parse(row.value)
    return {
      enabled: config.enabled ?? false,
      provider: config.provider ?? null,
      domain: config.domain ?? null,
      lastUpdate: config.lastUpdate ?? null,
      lastIp: config.lastIp ?? null,
      status: config.status ?? 'not_configured',
    }
  } catch {
    return defaultStatus
  }
}

// ─── Samba helpers ────────────────────────────────────────────────────────────

const SMB_CONF = '/etc/samba/smb.conf'

function readSmbConf(): string {
  try {
    return readFileSync(SMB_CONF, 'utf-8')
  } catch {
    return ''
  }
}

async function writeSmbConf(content: string): Promise<void> {
  await writeFileAsRoot(SMB_CONF, content, 0o644)
}

// ─── listSambaShares ──────────────────────────────────────────────────────────

export async function listSambaShares(): Promise<SambaShare[]> {
  const content = readSmbConf()
  if (!content) return []

  const shares: SambaShare[] = []
  const sections = content.split(/^\[/m)

  for (const section of sections) {
    const lines = section.split('\n')
    const header = lines[0]?.trim().replace(/]$/, '')
    if (!header || header === 'global' || header === 'homes' || header === 'printers') continue

    const get = (key: string): string | null => {
      const line = lines.find((l) => l.trim().toLowerCase().startsWith(key.toLowerCase() + '=') ||
        l.trim().toLowerCase().startsWith(key.toLowerCase() + ' ='))
      if (!line) return null
      const idx = line.indexOf('=')
      return idx !== -1 ? line.slice(idx + 1).trim() : null
    }

    const path = get('path')
    if (!path) continue

    const publicVal = (get('public') ?? get('guest ok') ?? 'no').toLowerCase()
    const writableVal = (get('writable') ?? get('writeable') ?? get('write ok') ?? 'no').toLowerCase()
    const readonlyVal = (get('read only') ?? 'no').toLowerCase()
    const validUsersVal = get('valid users') ?? ''
    const commentVal = get('comment') ?? ''

    shares.push({
      name: header,
      path,
      comment: commentVal,
      public: publicVal === 'yes',
      writable: writableVal === 'yes' || readonlyVal === 'no',
      validUsers: validUsersVal ? validUsersVal.split(/[,\s]+/).filter(Boolean) : [],
    })
  }

  return shares
}

// ─── createSambaShare ─────────────────────────────────────────────────────────

const SHARE_ALLOWED_PREFIXES = ['/mnt/']

function validateSharePath(p: string): void {
  const normalized = normalizePath(p)
  if (!SHARE_ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`Share path must be under /mnt/ (got: ${p})`)
  }
}

export async function createSambaShare(share: CreateSambaShareInput): Promise<SambaShare> {
  const { name, path, comment, readonly, guestOk, validUsers } = share

  // Validate name (already validated by zod, belt-and-suspenders)
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
    throw new Error('Invalid share name')
  }

  // Validate path
  validateSharePath(path)

  // Reject control chars that would inject extra smb.conf directives
  assertConfigSafe(path, 'path')
  assertConfigSafe(comment, 'comment')
  assertConfigSafe(validUsers, 'valid users')

  // Check if share already exists
  const existing = await listSambaShares()
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Share "${name}" already exists`)
  }

  // Create path if it doesn't exist
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }

  // Build section
  const lines: string[] = [
    `[${name}]`,
    `   path = ${path}`,
    `   comment = ${comment}`,
    `   read only = ${readonly ? 'yes' : 'no'}`,
    `   guest ok = ${guestOk ? 'yes' : 'no'}`,
  ]
  if (validUsers.trim()) {
    lines.push(`   valid users = ${validUsers.trim()}`)
  }
  lines.push('')

  const conf = readSmbConf()
  await writeSmbConf(conf + '\n' + lines.join('\n'))

  // Restart Samba
  await exec('systemctl', ['restart', 'smbd'])

  return {
    name,
    path,
    comment,
    public: guestOk,
    writable: !readonly,
    validUsers: validUsers.trim() ? validUsers.trim().split(/[,\s]+/).filter(Boolean) : [],
  }
}

// ─── updateSambaShare ─────────────────────────────────────────────────────────

export async function updateSambaShare(
  name: string,
  fields: UpdateSambaShareInput
): Promise<SambaShare> {
  const conf = readSmbConf()
  if (!conf) throw new Error('smb.conf not found')

  // Split into sections
  const sections = conf.split(/(?=^\[)/m)
  let found = false

  const updatedSections = sections.map((section) => {
    const headerMatch = section.match(/^\[([^\]]+)\]/)
    if (!headerMatch || headerMatch[1] !== name) return section
    found = true

    const lines = section.split('\n')
    const header = lines[0]

    const setLine = (key: string, value: string | undefined) => {
      if (value === undefined) return
      assertConfigSafe(value, key)
      const idx = lines.findIndex((l) =>
        l.trim().toLowerCase().startsWith(key.toLowerCase() + ' =') ||
        l.trim().toLowerCase().startsWith(key.toLowerCase() + '=')
      )
      const newLine = `   ${key} = ${value}`
      if (idx !== -1) {
        lines[idx] = newLine
      } else {
        // Insert before trailing empty lines
        const lastNonEmpty = lines.reduce((acc, l, i) => l.trim() ? i : acc, 0)
        lines.splice(lastNonEmpty + 1, 0, newLine)
      }
    }

    if (fields.path !== undefined) {
      validateSharePath(fields.path)
      setLine('path', fields.path)
    }
    if (fields.comment !== undefined) setLine('comment', fields.comment)
    if (fields.readonly !== undefined) setLine('read only', fields.readonly ? 'yes' : 'no')
    if (fields.guestOk !== undefined) setLine('guest ok', fields.guestOk ? 'yes' : 'no')
    if (fields.validUsers !== undefined) setLine('valid users', fields.validUsers)

    return [header, ...lines.slice(1)].join('\n')
  })

  if (!found) throw new Error(`Share "${name}" not found`)

  await writeSmbConf(updatedSections.join(''))
  await exec('systemctl', ['restart', 'smbd'])

  // Return updated share
  const updated = await listSambaShares()
  const share = updated.find((s) => s.name === name)
  if (!share) throw new Error(`Share "${name}" not found after update`)
  return share
}

// ─── deleteSambaShare ─────────────────────────────────────────────────────────

export async function deleteSambaShare(name: string): Promise<void> {
  const conf = readSmbConf()
  if (!conf) throw new Error('smb.conf not found')

  // Split into sections and filter out the target share
  const sections = conf.split(/(?=^\[)/m)
  const filtered = sections.filter((section) => {
    const headerMatch = section.match(/^\[([^\]]+)\]/)
    if (!headerMatch) return true
    return headerMatch[1] !== name
  })

  if (filtered.length === sections.length) {
    throw new Error(`Share "${name}" not found`)
  }

  await writeSmbConf(filtered.join(''))
  await exec('systemctl', ['restart', 'smbd'])
}

// ─── listConnectedUsers ───────────────────────────────────────────────────────

export async function listConnectedUsers(): Promise<SambaSession[]> {
  const result = await exec('smbstatus', ['-S'])
  if (result.exitCode !== 0) return []

  const sessions: SambaSession[] = []
  const lines = result.stdout.split('\n')

  // smbstatus -S output:
  // Service      pid     Machine       Connected at                     Encryption   Signing
  // -------      ---     -------       ------------                     ----------   -------
  // myshare      1234    192.168.1.10  Mon Apr 14 10:00:00 2026         -            -
  let inTable = false
  for (const line of lines) {
    if (line.match(/^-{3,}/)) {
      inTable = true
      continue
    }
    if (!inTable) continue
    const trimmed = line.trim()
    if (!trimmed) continue

    const parts = trimmed.split(/\s+/)
    // At least: service, pid, machine, date parts
    if (parts.length < 4) continue

    const [service, pid, machine, ...dateParts] = parts
    // Date is "Mon Apr 14 10:00:00 2026" — take first 5 date tokens
    const connectedAt = dateParts.slice(0, 5).join(' ')

    sessions.push({ pid: pid ?? '', user: service ?? '', machine: machine ?? '', connectedAt })
  }

  return sessions
}

// ─── NFS helpers ──────────────────────────────────────────────────────────────

const EXPORTS_FILE = '/etc/exports'

/** Stable djb2-style hash code for a string, used to derive fsid */
function hashCode(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i)
    // Keep it within 32-bit signed range
    h = h | 0
  }
  return h
}

/** Derive a stable fsid (0–65534) from a path */
function pathToFsid(path: string): number {
  return Math.abs(hashCode(path)) % 65535
}

function readExportsFile(): string {
  try {
    return readFileSync(EXPORTS_FILE, 'utf-8')
  } catch {
    return ''
  }
}

async function writeExportsFile(content: string): Promise<void> {
  await writeFileAsRoot(EXPORTS_FILE, content, 0o644)
}

function parseNfsExports(content: string): NfsExport[] {
  const exports_: NfsExport[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Format: /path client1(options) client2(options)
    const match = trimmed.match(/^(\S+)\s+(.+)$/)
    if (!match) continue

    const path = match[1]
    const rest = match[2].trim()

    // Parse first client+options pair
    const clientMatch = rest.match(/^(\S+?)(\([^)]*\))?(\s+.*)?$/)
    if (!clientMatch) continue

    const clients = clientMatch[1]
    const options = clientMatch[2] ? clientMatch[2].replace(/[()]/g, '') : 'ro'

    exports_.push({ path, clients, options })
  }

  return exports_
}

/** Build a canonical /etc/exports line with fsid automatically injected for FUSE mounts */
function buildExportLine(path: string, clients: string, options: string): string {
  // Reject control chars that would inject additional /etc/exports lines
  // (e.g. a second entry exporting `/` with no_root_squash).
  assertConfigSafe(path, 'path')
  assertConfigSafe(clients, 'clients')
  assertConfigSafe(options, 'options')
  // Ensure fsid is present (required for MergerFS / FUSE filesystems)
  const fsid = pathToFsid(path)
  const optParts = options.split(',').map((o) => o.trim()).filter(Boolean)
  if (!optParts.some((o) => o.startsWith('fsid='))) {
    optParts.push(`fsid=${fsid}`)
  }
  const finalOptions = optParts.join(',')
  return `${path}\t${clients}(${finalOptions})`
}

async function reloadExports(): Promise<void> {
  await exec('exportfs', ['-ra'])
}

// ─── listNfsExports ───────────────────────────────────────────────────────────

export async function listNfsExports(): Promise<NfsExport[]> {
  return parseNfsExports(readExportsFile())
}

// ─── getNfsStatus ─────────────────────────────────────────────────────────────

export async function getNfsStatus(): Promise<NfsStatus> {
  const exports_ = parseNfsExports(readExportsFile())
  const connectedClients = await getNfsConnectedClients()
  return { exports: exports_, connectedClients }
}

// ─── getNfsConnectedClients ───────────────────────────────────────────────────

export async function getNfsConnectedClients(): Promise<string[]> {
  // ss -tnp | grep ':2049'
  const result = await exec('ss', ['-tnp'])
  if (result.exitCode !== 0 || !result.stdout) return []

  const clients: string[] = []
  const seen = new Set<string>()

  for (const line of result.stdout.split('\n')) {
    if (!line.includes(':2049')) continue
    // ss output columns: State Recv-Q Send-Q Local Address:Port Peer Address:Port
    // We want the Peer address when Local ends in :2049
    // Example: ESTAB 0 0 192.168.1.1:2049 192.168.1.50:749
    const cols = line.trim().split(/\s+/)
    // Find "Local" col containing :2049, then Peer is the next col
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i] ?? ''
      if (col.endsWith(':2049') || col.includes(':2049')) {
        // This is the local port; next col is the peer
        const peer = cols[i + 1]
        if (peer) {
          // Strip port from peer: "192.168.1.50:749" or "[::ffff:192.168.1.50]:749"
          const ipMatch = peer.match(/^(?:\[?::ffff:)?([\d.]+)(?:\])?:\d+$/) ??
            peer.match(/^([\da-fA-F:]+)(?::\d+)?$/)
          const ip = ipMatch?.[1] ?? peer.split(':').slice(0, -1).join(':')
          if (ip && ip !== '127.0.0.1' && ip !== '::1' && !seen.has(ip)) {
            seen.add(ip)
            clients.push(ip)
          }
        }
        break
      }
    }
  }

  return clients
}

// ─── createNfsExport ──────────────────────────────────────────────────────────

export async function createNfsExport(input: CreateNfsExportInput): Promise<NfsExport> {
  // Resolve path — use it directly if absolute (avoid double-concatenation)
  const path = input.path.startsWith('/') ? input.path : `/${input.path}`

  // Validate path
  validateSharePath(path)

  // Create directory if it doesn't exist
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }

  // Check for duplicates
  const existing = parseNfsExports(readExportsFile())
  if (existing.some((e) => e.path === path)) {
    throw new Error(`Export "${path}" already exists`)
  }

  const line = buildExportLine(path, input.clients, input.options)
  const content = readExportsFile()
  const newContent = content ? `${content.trimEnd()}\n${line}\n` : `${line}\n`
  await writeExportsFile(newContent)

  await reloadExports()

  // Parse back to get canonical options (with fsid)
  const updated = parseNfsExports(newContent)
  const created = updated.find((e) => e.path === path)
  return created ?? { path, clients: input.clients, options: input.options }
}

// ─── updateNfsExport ──────────────────────────────────────────────────────────

export async function updateNfsExport(
  path: string,
  fields: UpdateNfsExportInput
): Promise<NfsExport> {
  const content = readExportsFile()
  if (!content) throw new Error('/etc/exports not found')

  let found = false
  const newLines = content.split('\n').map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const match = trimmed.match(/^(\S+)\s+(.+)$/)
    if (!match || match[1] !== path) return line

    found = true
    const newClients = fields.clients ?? match[2].split('(')[0] ?? '*'
    const rawOptions = fields.options ?? (match[2].match(/\(([^)]*)\)/)?.[1] ?? 'ro,sync,no_subtree_check')
    return buildExportLine(path, newClients, rawOptions)
  })

  if (!found) throw new Error(`Export "${path}" not found`)

  await writeExportsFile(newLines.join('\n'))
  await reloadExports()

  const updated = parseNfsExports(newLines.join('\n'))
  const exp = updated.find((e) => e.path === path)
  if (!exp) throw new Error(`Export "${path}" not found after update`)
  return exp
}

// ─── deleteNfsExport ──────────────────────────────────────────────────────────

export async function deleteNfsExport(path: string): Promise<void> {
  const content = readExportsFile()
  if (!content) throw new Error('/etc/exports not found')

  let found = false
  const newLines = content.split('\n').filter((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return true
    const match = trimmed.match(/^(\S+)/)
    if (match?.[1] === path) {
      found = true
      return false
    }
    return true
  })

  if (!found) throw new Error(`Export "${path}" not found`)

  await writeExportsFile(newLines.join('\n'))
  await reloadExports()
}

// ─── Network bandwidth stats ──────────────────────────────────────────────────

interface IfaceSnapshot {
  timestamp: number
  rxBytes: number
  txBytes: number
}

// In-memory previous snapshots keyed by interface name
const bandwidthSnapshots = new Map<string, IfaceSnapshot>()

interface IfaceBandwidth {
  name: string
  rxBytesPerSec: number
  txBytesPerSec: number
}

export async function getNetworkBandwidthStats(): Promise<{ interfaces: IfaceBandwidth[] }> {
  let content: string
  try {
    content = await readFile('/proc/net/dev', 'utf-8')
  } catch {
    return { interfaces: [] }
  }

  const now = Date.now()
  const result: IfaceBandwidth[] = []

  // /proc/net/dev format (skip first 2 header lines):
  // iface: rx_bytes rx_packets rx_errs ... tx_bytes ...
  const lines = content.split('\n').slice(2)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const name = trimmed.slice(0, colonIdx).trim()
    if (/^(docker\d*|veth|br-|virbr|lo$|bond\d|dummy|tun\d|tap\d)/.test(name)) continue
    const cols = trimmed.slice(colonIdx + 1).trim().split(/\s+/)
    const rxBytes = parseInt(cols[0] ?? '0', 10)
    const txBytes = parseInt(cols[8] ?? '0', 10)
    if (isNaN(rxBytes) || isNaN(txBytes)) continue

    const prev = bandwidthSnapshots.get(name)
    let rxBytesPerSec = 0
    let txBytesPerSec = 0

    if (prev) {
      const elapsed = (now - prev.timestamp) / 1000
      if (elapsed > 0) {
        rxBytesPerSec = Math.max(0, (rxBytes - prev.rxBytes) / elapsed)
        txBytesPerSec = Math.max(0, (txBytes - prev.txBytes) / elapsed)
      }
    }

    bandwidthSnapshots.set(name, { timestamp: now, rxBytes, txBytes })
    result.push({ name, rxBytesPerSec, txBytesPerSec })
  }

  return { interfaces: result }
}
