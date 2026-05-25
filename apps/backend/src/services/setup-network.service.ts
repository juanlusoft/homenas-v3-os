import { readFileSync, writeFileSync } from 'node:fs'
import { exec } from '../lib/exec.js'

export interface NetworkInfo {
  interfaces: { name: string; ip: string | null; isDhcp: boolean }[]
}

export interface SetupNetworkInput {
  interface: string
  mode: 'dhcp' | 'static'
  ip?: string
  prefix?: number      // e.g. 24
  gateway?: string
  dns?: string         // primary DNS
}

// ── Input validation ──────────────────────────────────────────────────────────

function validateIface(iface: string): void {
  if (!/^[a-zA-Z0-9_.\-]{1,15}$/.test(iface)) {
    throw new Error(`Invalid interface name: ${iface}`)
  }
}

function validateIPv4(ip: string, label: string): void {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some(n => parseInt(n, 10) > 255)) {
    throw new Error(`Invalid ${label}: ${ip}`)
  }
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0
}

function validateGatewayInSubnet(ip: string, prefix: number, gateway: string): void {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  const networkAddr = (ipToInt(ip) & mask) >>> 0
  const gatewayInt = ipToInt(gateway)
  const gatewayNetwork = (gatewayInt & mask) >>> 0
  if (networkAddr !== gatewayNetwork) {
    throw new Error(
      `Gateway ${gateway} is not in the same subnet as ${ip}/${prefix}`
    )
  }
}

// ── Detection helpers ─────────────────────────────────────────────────────────

async function hasCmd(cmd: string): Promise<boolean> {
  const r = await exec('which', [cmd])
  return r.exitCode === 0
}

// Check if an interface is currently configured via DHCP.
// We probe NetworkManager first (via connection show), then dhcpcd lease files, then assume DHCP.
async function isDhcp(iface: string): Promise<boolean> {
  // NetworkManager: search active connections first, then all connections (interface may be DOWN)
  for (const extraArgs of [['--active'], []]) {
    const conResult = await exec('nmcli', ['-t', '-f', 'NAME,DEVICE', 'con', 'show', ...extraArgs])
    if (conResult.exitCode !== 0) continue
    for (const line of conResult.stdout.trim().split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const name = line.slice(0, colonIdx)
      const device = line.slice(colonIdx + 1)
      if (device === iface) {
        const methodResult = await exec('nmcli', ['-t', '-f', 'ipv4.method', 'con', 'show', name])
        if (methodResult.exitCode === 0) {
          // terse output: "ipv4.method:auto" or "ipv4.method:manual"
          const method = methodResult.stdout.trim().split(':').pop() ?? ''
          return method !== 'manual'
        }
      }
    }
  }
  // dhcpcd lease file fallback
  const leaseFiles = [
    `/var/lib/dhcpcd5/dhcpcd-${iface}.lease`,
    `/var/lib/dhcpcd/${iface}.lease`,
    `/var/lib/dhcp/dhclient.${iface}.leases`,
  ]
  for (const f of leaseFiles) {
    try { readFileSync(f); return true } catch { /* not found */ }
  }
  return true // no connection found → assume DHCP (safer default for unconfigured interfaces)
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getNetworkInfo(): Promise<NetworkInfo> {
  const result = await exec('ip', ['-j', 'addr'])
  if (result.exitCode !== 0 || !result.stdout) return { interfaces: [] }

  let data: { ifname: string; flags?: string[]; addr_info?: { family: string; local: string }[] }[] = []
  try { data = JSON.parse(result.stdout) } catch { return { interfaces: [] } }

  const physical = data.filter(i => {
    const name = i.ifname
    if (name === 'lo') return false
    if (/^(docker|br-|veth|tun|tap|virbr)/.test(name)) return false
    return true
  })

  const interfaces = await Promise.all(
    physical.map(async (i) => {
      const ipv4 = i.addr_info?.find(a => a.family === 'inet')?.local ?? null
      return {
        name: i.ifname,
        ip: ipv4,
        isDhcp: await isDhcp(i.ifname).catch(() => true),
      }
    })
  )

  return { interfaces: interfaces.filter(i => i.ip !== null || true) }
}

export async function configureNetwork(input: SetupNetworkInput): Promise<void> {
  validateIface(input.interface)

  if (input.mode === 'static') {
    if (!input.ip) throw new Error('IP is required for static mode')
    if (!input.prefix || input.prefix < 1 || input.prefix > 32) throw new Error('Prefix must be 1-32')
    if (!input.gateway) throw new Error('Gateway is required for static mode')
    validateIPv4(input.ip, 'ip')
    validateIPv4(input.gateway, 'gateway')
    if (input.dns) validateIPv4(input.dns, 'dns')
    validateGatewayInSubnet(input.ip, input.prefix, input.gateway)
  }

  if (await hasCmd('nmcli')) {
    await configureWithNmcli(input)
  } else if (await hasCmd('dhcpcd')) {
    await configureWithDhcpcd(input)
  } else {
    throw new Error('No supported network manager found (nmcli or dhcpcd)')
  }
}

// ── nmcli backend ─────────────────────────────────────────────────────────────

async function configureWithNmcli(input: SetupNetworkInput): Promise<void> {
  const { interface: iface, mode, ip, prefix, gateway, dns } = input

  // Find active connection for this device
  const conResult = await exec('nmcli', ['-t', '-f', 'NAME,DEVICE', 'con', 'show'])
  let connName = ''
  for (const line of conResult.stdout.trim().split('\n')) {
    const [name, device] = line.split(':')
    if (device === iface && name) { connName = name; break }
  }

  // If no connection found, create one
  if (!connName) {
    connName = iface
    await exec('nmcli', ['con', 'add', 'type', 'ethernet', 'ifname', iface, 'con-name', iface])
  }

  const args = mode === 'dhcp'
    ? ['con', 'mod', connName, 'ipv4.method', 'auto', 'ipv4.addresses', '', 'ipv4.gateway', '', 'ipv4.dns', '']
    : ['con', 'mod', connName,
        'ipv4.method', 'manual',
        'ipv4.addresses', `${ip}/${prefix}`,
        'ipv4.gateway', gateway!,
        'ipv4.dns', dns || '8.8.8.8',
      ]

  const modResult = await exec('nmcli', args)
  if (modResult.exitCode !== 0) throw new Error(`nmcli modify failed: ${modResult.stderr}`)

  await exec('nmcli', ['con', 'up', connName])
}

// ── dhcpcd backend ────────────────────────────────────────────────────────────

async function configureWithDhcpcd(input: SetupNetworkInput): Promise<void> {
  const { interface: iface, mode, ip, prefix, gateway, dns } = input
  const confPath = '/etc/dhcpcd.conf'

  let content = ''
  try { content = readFileSync(confPath, 'utf8') } catch { content = '' }

  // Remove previous static block for this interface
  // Matches: "interface IFACE\nstatic ...\nstatic ...\n" until next empty line or EOF
  const blockRe = new RegExp(`\\ninterface ${iface}\\n(?:(?:static|nohook|noarp|inform) [^\\n]*\\n)*`, 'g')
  content = content.replace(blockRe, '\n').trimEnd()

  if (mode === 'static') {
    content += `\ninterface ${iface}\n`
    content += `static ip_address=${ip}/${prefix}\n`
    content += `static routers=${gateway}\n`
    content += `static domain_name_servers=${dns ?? '8.8.8.8 8.8.4.4'}\n`
  }

  writeFileSync(confPath, content + '\n', 'utf8')
  await exec('systemctl', ['restart', 'dhcpcd'])
}
