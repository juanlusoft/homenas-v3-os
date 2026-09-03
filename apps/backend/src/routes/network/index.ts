import type { FastifyInstance } from 'fastify'
import {
  AddWireguardPeerSchema,
  WireguardInitSchema,
  CreateSambaShareSchema,
  UpdateSambaShareSchema,
  CreateNfsExportSchema,
  UpdateNfsExportSchema,
} from '@homenas/shared'
import { z } from 'zod'
import { getNetworkInfo, configureNetwork } from '../../services/setup-network.service.js'
import {
  listInterfaces,
  getWireguardStatus,
  installWireguard,
  initWireguard,
  startWireguard,
  stopWireguard,
  restartWireguard,
  addWireguardPeer,
  removeWireguardPeer,
  getPeerConfig,
  getDdnsStatus,
  listSambaShares,
  createSambaShare,
  updateSambaShare,
  deleteSambaShare,
  listConnectedUsers,
  listNfsExports,
  getNfsStatus,
  createNfsExport,
  updateNfsExport,
  deleteNfsExport,
  getNetworkBandwidthStats,
} from '../../services/network.service.js'
import { cloudflareRoutes } from './cloudflare.js'

// Standard WireGuard public key: 32 bytes base64-encoded → 43 chars + '='
const WG_PUBKEY_RE = /^[A-Za-z0-9+/]{43}=$/

export async function networkRoutes(fastify: FastifyInstance) {
  const { requireAuth, requireAdmin } = fastify

  // Cloudflare Tunnel sub-routes
  fastify.register(cloudflareRoutes, { prefix: '/cloudflare' })

  // ─── Interfaces ────────────────────────────────────────────────────────────

  // GET /api/network/interfaces
  fastify.get('/interfaces', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const interfaces = await listInterfaces()
    return reply.send(interfaces)
  })

  // GET /api/network/public-ip
  let cachedPublicIp: { ip: string; fetchedAt: number } | null = null
  fastify.get('/public-ip', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const now = Date.now()
    // Cache for 5 minutes to avoid hammering ipify
    if (cachedPublicIp && now - cachedPublicIp.fetchedAt < 5 * 60 * 1000) {
      return reply.send({ ip: cachedPublicIp.ip })
    }
    try {
      const res = await fetch('https://api.ipify.org?format=text', { signal: AbortSignal.timeout(5000) })
      const ip = (await res.text()).trim()
      cachedPublicIp = { ip, fetchedAt: now }
      return reply.send({ ip })
    } catch {
      const ip = cachedPublicIp?.ip ?? null
      return reply.send({ ip })
    }
  })

  // ─── WireGuard ─────────────────────────────────────────────────────────────

  // GET /api/network/wireguard/status
  fastify.get('/wireguard/status', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const status = await getWireguardStatus()
    return reply.send(status)
  })

  // POST /api/network/wireguard/install
  fastify.post('/wireguard/install', {
    preHandler: [requireAuth, requireAdmin],
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
  }, async (_request, reply) => {
    try {
      const result = await installWireguard()
      return reply.send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // POST /api/network/wireguard/init
  fastify.post('/wireguard/init', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = WireguardInitSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      await initWireguard(result.data)
      return reply.send({ initialized: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // POST /api/network/wireguard/start
  fastify.post('/wireguard/start', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    try {
      await startWireguard()
      return reply.send({ started: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // POST /api/network/wireguard/stop
  fastify.post('/wireguard/stop', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    try {
      await stopWireguard()
      return reply.send({ stopped: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // POST /api/network/wireguard/restart
  fastify.post('/wireguard/restart', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    try {
      await restartWireguard()
      return reply.send({ restarted: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // POST /api/network/wireguard/peers
  fastify.post('/wireguard/peers', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = AddWireguardPeerSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }

    try {
      const peer = await addWireguardPeer(result.data)
      return reply.send(peer)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // DELETE /api/network/wireguard/peers/:publicKey
  fastify.delete('/wireguard/peers/:publicKey', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { publicKey } = request.params as { publicKey: string }
    // Full-key match required: removeWireguardPeer filters wg0.conf sections
    // with includes(publicKey), so a partial key could wipe every peer.
    if (!publicKey || !WG_PUBKEY_RE.test(publicKey)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid WireGuard public key' })
    }

    try {
      await removeWireguardPeer(publicKey)
      return reply.send({ removed: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // GET /api/network/wireguard/peers/:publicKey/config
  fastify.get('/wireguard/peers/:publicKey/config', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { publicKey } = request.params as { publicKey: string }
    if (!publicKey || !WG_PUBKEY_RE.test(publicKey)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid WireGuard public key' })
    }

    try {
      const result = await getPeerConfig(publicKey)
      return reply.send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(404).send({ error: 'Not Found', message })
    }
  })

  // ─── DDNS ──────────────────────────────────────────────────────────────────

  // GET /api/network/ddns/status
  fastify.get('/ddns/status', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const status = await getDdnsStatus(fastify.db)
    return reply.send(status)
  })

  // ─── Samba ─────────────────────────────────────────────────────────────────

  // GET /api/network/samba/shares
  fastify.get('/samba/shares', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const shares = await listSambaShares()
    return reply.send(shares)
  })

  // POST /api/network/samba/shares
  fastify.post('/samba/shares', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = CreateSambaShareSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      const share = await createSambaShare(result.data)
      return reply.status(201).send(share)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // PUT /api/network/samba/shares/:name
  fastify.put('/samba/shares/:name', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { name } = request.params as { name: string }
    const result = UpdateSambaShareSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      const share = await updateSambaShare(name, result.data)
      return reply.send(share)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message.includes('not found') ? 404 : 500
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Internal Server Error', message })
    }
  })

  // DELETE /api/network/samba/shares/:name
  fastify.delete('/samba/shares/:name', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { name } = request.params as { name: string }
    try {
      await deleteSambaShare(name)
      return reply.send({ deleted: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message.includes('not found') ? 404 : 500
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Internal Server Error', message })
    }
  })

  // GET /api/network/samba/sessions
  fastify.get('/samba/sessions', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const sessions = await listConnectedUsers()
    return reply.send(sessions)
  })

  // ─── NFS ───────────────────────────────────────────────────────────────────

  // GET /api/network/nfs/exports
  fastify.get('/nfs/exports', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const exports_ = await listNfsExports()
    return reply.send(exports_)
  })

  // GET /api/network/nfs/status
  fastify.get('/nfs/status', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const status = await getNfsStatus()
    return reply.send(status)
  })

  // POST /api/network/nfs/exports
  fastify.post('/nfs/exports', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = CreateNfsExportSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      const exp = await createNfsExport(result.data)
      return reply.status(201).send(exp)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // PUT /api/network/nfs/exports/:path
  fastify.put('/nfs/exports/:exportPath', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { exportPath } = request.params as { exportPath: string }
    const decodedPath = decodeURIComponent(exportPath)
    const result = UpdateNfsExportSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      const exp = await updateNfsExport(decodedPath, result.data)
      return reply.send(exp)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message.includes('not found') ? 404 : 500
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Internal Server Error', message })
    }
  })

  // DELETE /api/network/nfs/exports/:path
  fastify.delete('/nfs/exports/:exportPath', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { exportPath } = request.params as { exportPath: string }
    const decodedPath = decodeURIComponent(exportPath)
    try {
      await deleteNfsExport(decodedPath)
      return reply.send({ deleted: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message.includes('not found') ? 404 : 500
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Internal Server Error', message })
    }
  })

  // GET /api/network/stats
  fastify.get('/stats', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const stats = await getNetworkBandwidthStats()
    return reply.send(stats)
  })

  // ─── IP Configuration ──────────────────────────────────────────────────────

  const IpConfigSchema = z.object({
    interface: z.string().min(1).max(15).regex(/^[a-zA-Z0-9_.\-]+$/),
    mode:      z.enum(['dhcp', 'static']),
    ip:        z.string().optional(),
    prefix:    z.number().int().min(1).max(32).optional(),
    gateway:   z.string().optional(),
    dns:       z.string().optional(),
  })

  // GET /api/network/ip-config — current IP mode per interface
  fastify.get('/ip-config', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    try {
      const info = await getNetworkInfo()
      return reply.send(info)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // POST /api/network/ip-config — switch interface between DHCP and static
  fastify.post('/ip-config', {
    preHandler: [requireAuth, requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parsed = IpConfigSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Bad Request', message: parsed.error.errors[0]?.message ?? parsed.error.message })
    }
    try {
      await configureNetwork(parsed.data)
      return reply.send({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })
}
