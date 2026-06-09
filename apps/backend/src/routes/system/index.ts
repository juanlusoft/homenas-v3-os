import type { FastifyInstance } from 'fastify'
import { execa } from 'execa'
import { join } from 'node:path'
import { getSystemMetrics } from '../../services/system.service.js'
import { systemInfoRoutes } from './info.js'

export async function systemRoutes(fastify: FastifyInstance) {
  const { requireAuth, requireAdmin } = fastify

  // GET /api/system/metrics
  fastify.get('/metrics', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const metrics = await getSystemMetrics()
    return reply.send(metrics)
  })

  // POST /api/system/reboot
  fastify.post('/reboot', {
    preHandler: [requireAuth, requireAdmin],
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    // Reboot after a short delay so the response can be sent first
    fastify.db.prepare(`INSERT INTO audit_log (user_id, username, action, ip) VALUES (?, ?, 'reboot', ?)`)
      .run(request.user.id, request.user.username, request.ip)
    setTimeout(() => {
      void execa('sudo', ['shutdown', '-r', 'now'], { reject: false })
    }, 500)
    return reply.send({ ok: true })
  })

  // GET /api/system/db-backup — hot backup of homenas.db as download (admin only)
  fastify.get('/db-backup', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    const { createReadStream, unlinkSync, statSync } = await import('node:fs')
    const backupPath = join(process.cwd(), 'data', `homenas-backup-${Date.now()}.db`)
    try {
      await fastify.db.backup(backupPath)
      const stat = statSync(backupPath)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      reply.header('Content-Disposition', `attachment; filename="homenas-${timestamp}.db"`)
      reply.header('Content-Type', 'application/octet-stream')
      reply.header('Content-Length', stat.size)
      const stream = createReadStream(backupPath)
      stream.on('close', () => { try { unlinkSync(backupPath) } catch { /* ok */ } })
      return reply.send(stream)
    } catch (err) {
      try { unlinkSync(backupPath) } catch { /* ok */ }
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // POST /api/system/db-integrity — run PRAGMA integrity_check (admin only)
  fastify.post('/db-integrity', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    try {
      const rows = fastify.db.pragma('integrity_check') as { integrity_check: string }[]
      const ok = rows.length === 1 && rows[0]?.integrity_check === 'ok'
      return reply.send({ ok, details: rows.map((r) => r.integrity_check) })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }
  })

  // ─── SSH ────────────────────────────────────────────────────────────────────

  // Try 'ssh' (Debian/Raspberry Pi), fall back to 'sshd'
  async function sshServiceName(): Promise<string> {
    const r = await execa('systemctl', ['cat', 'ssh'], { reject: false })
    return r.exitCode === 0 ? 'ssh' : 'sshd'
  }

  // GET /api/system/ssh — returns { active: boolean }
  fastify.get('/ssh', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    try {
      const svc = await sshServiceName()
      const r = await execa('systemctl', ['is-active', svc], { reject: false })
      return reply.send({ active: r.stdout.trim() === 'active', service: svc })
    } catch {
      return reply.send({ active: false, service: 'ssh' })
    }
  })

  // POST /api/system/ssh/enable
  fastify.post('/ssh/enable', {
    preHandler: [requireAuth, requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const svc = await sshServiceName()
    await execa('sudo', ['systemctl', 'enable', '--now', svc], { reject: false })
    fastify.db.prepare(`INSERT INTO audit_log (user_id, username, action, detail, ip) VALUES (?, ?, 'ssh_enabled', ?, ?)`)
      .run(request.user.id, request.user.username, `service: ${svc}`, request.ip)
    return reply.send({ ok: true })
  })

  // POST /api/system/ssh/disable
  fastify.post('/ssh/disable', {
    preHandler: [requireAuth, requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const svc = await sshServiceName()
    await execa('sudo', ['systemctl', 'disable', '--now', svc], { reject: false })
    fastify.db.prepare(`INSERT INTO audit_log (user_id, username, action, detail, ip) VALUES (?, ?, 'ssh_disabled', ?, ?)`)
      .run(request.user.id, request.user.username, `service: ${svc}`, request.ip)
    return reply.send({ ok: true })
  })

  // GET /api/system/audit-log — last 200 audit entries (admin only)
  fastify.get<{ Querystring: { limit?: string; offset?: string } }>('/audit-log', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '100', 10) || 100, 500)
    const offset = parseInt(request.query.offset ?? '0', 10) || 0
    const total = (fastify.db.prepare('SELECT COUNT(*) as n FROM audit_log').get() as { n: number }).n
    const items = fastify.db.prepare(
      `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset)
    return reply.send({ items, total, limit, offset })
  })

  // System info, UPS, notifications
  fastify.register(systemInfoRoutes)
}
