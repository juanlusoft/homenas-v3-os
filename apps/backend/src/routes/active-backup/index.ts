import { createReadStream, statSync, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import archiver from 'archiver'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import {
  RegisterDeviceSchema, AgentReportSchema,
  BackupBeginRequestSchema, FileCheckRequestSchema, BackupEndRequestSchema, UpdateDeviceSchema,
} from '@homenas/shared'
import { createActiveBackupService } from '../../services/active-backup.service.js'

// ─── Token auth helper ────────────────────────────────────────────────────────

function getAgentToken(request: FastifyRequest): string | null {
  const h = request.headers['x-agent-token']
  if (typeof h === 'string' && h.length >= 10) return h
  return null
}

export async function activeBackupRoutes(fastify: FastifyInstance) {
  const { requireAuth, requireAdmin } = fastify

  // ── Admin: device list ─────────────────────────────────────────────────────

  fastify.get<{ Querystring: { limit?: string; offset?: string } }>('/devices', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200)
    const offset = parseInt(request.query.offset ?? '0', 10) || 0
    const service = createActiveBackupService(fastify.db)
    return reply.send(service.listDevices(limit, offset))
  })

  // ── Admin: create device (manual, pre-approved) ───────────────────────────────
  fastify.post('/devices', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = RegisterDeviceSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    const service = createActiveBackupService(fastify.db)
    const reg = service.registerDevice(result.data)
    // Auto-approve so the admin can download the ZIP immediately
    service.approveDevice(reg.id)
    const device = service.getDevice(reg.id)
    return reply.status(201).send(device)
  })

  // ── Admin: device detail ───────────────────────────────────────────────────

  fastify.get('/devices/:id', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deviceId = parseInt(id, 10)
    if (isNaN(deviceId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      const device = service.getDevice(deviceId)
      const runs = service.listRuns(deviceId)
      return reply.send({ device, runs })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Device not found' ? 404 : 400
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Bad Request', message })
    }
  })

  // ── Admin: approve device ──────────────────────────────────────────────────

  fastify.post('/devices/:id/approve', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deviceId = parseInt(id, 10)
    if (isNaN(deviceId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      const device = service.approveDevice(deviceId)
      return reply.send(device)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Device not found' ? 404 : 409
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Conflict', message })
    }
  })

  // ── Admin: delete device ───────────────────────────────────────────────────

  fastify.delete('/devices/:id', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deviceId = parseInt(id, 10)
    if (isNaN(deviceId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      service.deleteDevice(deviceId)
      return reply.send({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Device not found' ? 404 : 400
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Bad Request', message })
    }
  })

  // ── Admin: trigger backup ──────────────────────────────────────────────────

  fastify.post('/devices/:id/backup', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deviceId = parseInt(id, 10)
    if (isNaN(deviceId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      const result = service.triggerBackup(deviceId)
      return reply.status(202).send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      let status = 400
      if (message === 'Device not found') status = 404
      else if (message.includes('already running') || message === 'Device not yet approved') status = 409
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : (status === 409 ? 'Conflict' : 'Bad Request'), message })
    }
  })

  // ── Admin: progress ────────────────────────────────────────────────────────

  fastify.get('/devices/:id/progress', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deviceId = parseInt(id, 10)
    if (isNaN(deviceId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
    }
    const service = createActiveBackupService(fastify.db)
    return reply.send(service.getRunProgress(deviceId))
  })

  // ── Admin: cancel backup ───────────────────────────────────────────────────

  fastify.post('/devices/:id/cancel', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deviceId = parseInt(id, 10)
    if (isNaN(deviceId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      service.cancelBackup(deviceId)
      return reply.send({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(409).send({ error: 'Conflict', message })
    }
  })

  // ── Admin: list versions ───────────────────────────────────────────────────

  fastify.get('/devices/:id/versions', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deviceId = parseInt(id, 10)
    if (isNaN(deviceId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      // Verify device exists
      service.getDevice(deviceId)
      return reply.send(service.listVersions(deviceId))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Device not found' ? 404 : 400
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Bad Request', message })
    }
  })

  // ── Admin: browse files ────────────────────────────────────────────────────

  fastify.get('/devices/:id/browse', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deviceId = parseInt(id, 10)
    if (isNaN(deviceId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
    }
    const { version, path: subPath } = request.query as { version?: string; path?: string }
    if (!version) {
      return reply.status(400).send({ error: 'Bad Request', message: 'version query param required' })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      const entries = service.browseFiles(deviceId, version, subPath ?? '/')
      return reply.send(entries)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      let status = 400
      if (message === 'Version not found' || message === 'Path not found') status = 404
      else if (message === 'Path traversal not allowed') status = 403
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : (status === 403 ? 'Forbidden' : 'Bad Request'), message })
    }
  })

  // ── Agent: register (no auth, rate limited) ────────────────────────────────

  fastify.post('/agent/register', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const result = RegisterDeviceSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    const service = createActiveBackupService(fastify.db)
    const reg = service.registerDevice(result.data)
    return reply.status(201).send(reg)
  })

  // ── Agent: poll for task (no auth) ─────────────────────────────────────────

  fastify.get('/agent/poll', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { token } = request.query as { token?: string }
    if (!token || typeof token !== 'string' || token.length < 10) {
      return reply.status(400).send({ error: 'Bad Request', message: 'token query param required' })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      const task = service.pollForTask(token)
      return reply.send(task)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(401).send({ error: 'Unauthorized', message })
    }
  })

  // ── Agent: report result (no auth) ────────────────────────────────────────

  fastify.post('/agent/report', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const result = AgentReportSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    const service = createActiveBackupService(fastify.db)
    try {
      service.reportRunResult(result.data)
      return reply.send({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Unknown token' || message === 'Run does not belong to this device' ? 401 : 404
      return reply.status(status).send({ error: status === 401 ? 'Unauthorized' : 'Not Found', message })
    }
  })

  // ── Agent: push-based backup — begin session ───────────────────────────────

  fastify.post('/agent/backup/begin', async (request, reply) => {
    const token = getAgentToken(request)
    if (!token) return reply.status(401).send({ error: 'Unauthorized', message: 'Missing X-Agent-Token' })

    const parsed = BackupBeginRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message })

    const service = createActiveBackupService(fastify.db)
    try {
      const result = service.beginBackupSession(token, parsed.data)
      return reply.status(201).send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Unknown token' || message === 'Device not yet approved' ? 401 : 400
      return reply.status(status).send({ error: status === 401 ? 'Unauthorized' : 'Bad Request', message })
    }
  })

  // ── Agent: push-based backup — file dedup check ────────────────────────────

  fastify.post('/agent/backup/file-check', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = getAgentToken(request)
    if (!token) return reply.status(401).send({ error: 'Unauthorized', message: 'Missing X-Agent-Token' })

    const parsed = FileCheckRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message })

    const service = createActiveBackupService(fastify.db)
    try {
      const result = service.checkFiles(parsed.data.session_id, token, parsed.data.files)
      return reply.send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(400).send({ error: 'Bad Request', message })
    }
  })

  // ── Agent: push-based backup — upload file chunk (multipart) ──────────────

  await fastify.register(async (sub) => {
    await sub.register(multipart, {
      limits: { fileSize: 8 * 1024 * 1024, fields: 20 },
    })

    sub.post('/agent/backup/file', {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const token = getAgentToken(request)
      if (!token) return reply.status(401).send({ error: 'Unauthorized', message: 'Missing X-Agent-Token' })

      const parts = request.parts()
      const fields: Record<string, string> = {}
      let dataStream: AsyncIterable<Buffer> | null = null

      for await (const part of parts) {
        if (part.type === 'field') {
          fields[part.fieldname] = part.value as string
        } else if (part.type === 'file' && part.fieldname === 'data') {
          dataStream = part.file
        }
      }

      if (!dataStream) return reply.status(400).send({ error: 'Bad Request', message: 'Missing data field' })

      const { session_id, path: filePath, hash, mtime, size, chunk_index, total_chunks } = fields
      if (!session_id || !filePath || !hash || !mtime || !size || chunk_index === undefined || !total_chunks) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Missing required fields' })
      }

      const service = createActiveBackupService(fastify.db)
      try {
        const { Readable } = await import('node:stream')
        const readable = Readable.from(dataStream as AsyncIterable<Buffer>)
        const result = await service.receiveFileChunk(session_id, token, {
          path: filePath,
          hash,
          mtime: parseInt(mtime, 10),
          size: parseInt(size, 10),
          chunkIndex: parseInt(chunk_index, 10),
          totalChunks: parseInt(total_chunks, 10),
          dataStream: readable,
        })
        return reply.send(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.status(400).send({ error: 'Bad Request', message })
      }
    })
  })

  // ── Agent: push-based backup — finalize session ────────────────────────────

  fastify.post('/agent/backup/end', async (request, reply) => {
    const token = getAgentToken(request)
    if (!token) return reply.status(401).send({ error: 'Unauthorized', message: 'Missing X-Agent-Token' })

    const parsed = BackupEndRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message })

    // Manifest is sent alongside the end request
    const body = request.body as { manifest?: unknown[] }
    const manifest = Array.isArray(body.manifest) ? body.manifest : []

    const service = createActiveBackupService(fastify.db)
    try {
      const result = await service.endBackupSession(parsed.data.session_id, token, {
        ...parsed.data,
        manifest: manifest as import('@homenas/shared').ManifestEntry[],
      })
      return reply.send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(400).send({ error: 'Bad Request', message })
    }
  })

  // ── Admin: update device ───────────────────────────────────────────────────

  fastify.patch<{ Params: { id: string } }>('/devices/:id', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const deviceId = parseInt(request.params.id, 10)
    if (isNaN(deviceId)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })

    const parsed = UpdateDeviceSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message })

    const service = createActiveBackupService(fastify.db)
    try {
      const device = service.updateDevice(deviceId, parsed.data)
      return reply.send(device)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(message === 'Device not found' ? 404 : 400).send({ error: 'Error', message })
    }
  })

  // ── Admin: restore — browse version ───────────────────────────────────────

  fastify.get<{ Params: { id: string }; Querystring: { version?: string; path?: string } }>(
    '/devices/:id/restore/browse', {
      preHandler: [requireAuth, requireAdmin],
    }, async (request, reply) => {
      const deviceId = parseInt(request.params.id, 10)
      if (isNaN(deviceId)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
      const { version, path: subPath } = request.query
      if (!version) return reply.status(400).send({ error: 'Bad Request', message: 'version required' })

      const service = createActiveBackupService(fastify.db)
      try {
        service.getDevice(deviceId) // verify exists
        const entries = service.browseVersion(deviceId, version, subPath ?? '/')
        return reply.send(entries)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.status(message === 'Device not found' ? 404 : 400).send({ error: 'Error', message })
      }
    }
  )

  // ── Admin: download pre-configured agent package ──────────────────────────

  fastify.get<{
    Params: { id: string }
    Querystring: { platform?: string }
  }>('/devices/:id/agent-package', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const deviceId = parseInt(request.params.id, 10)
    if (isNaN(deviceId)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })

    const platform = (request.query.platform ?? 'windows') as 'windows' | 'linux' | 'mac'

    const service = createActiveBackupService(fastify.db)
    const device = service.getDevice(deviceId)

    // Resolve agent binary path — look relative to the project root
    const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..', '..')
    const binaryName = platform === 'windows'
      ? 'homenas-agent.exe'
      : platform === 'mac'
        ? 'homenas-agent-mac-arm64'
        : 'homenas-agent-linux'
    const binaryPath = join(projectRoot, 'apps', 'agent', 'build', binaryName)

    if (!existsSync(binaryPath)) {
      return reply.status(503).send({
        error: 'Not Available',
        message: `Agent binary for ${platform} not built yet. Run: cd apps/agent && make build-${platform}`,
      })
    }

    // Detect NAS URL from request (use the same host:port the client connected to)
    const proto = request.headers['x-forwarded-proto'] ?? (fastify.initialConfig.https ? 'https' : 'http')
    const host  = request.headers['x-forwarded-host'] ?? request.headers.host ?? '192.168.1.101'
    const nasURL = `${proto}://${host}`

    // Default backup paths per platform
    const defaultPaths = platform === 'windows'
      ? ['C:\\Users']
      : platform === 'mac'
        ? ['~/Desktop', '~/Documents', '~/Pictures']
        : ['/home']

    // Config JSON that will be bundled alongside the binary
    const configJSON = JSON.stringify({
      nas_url: nasURL,
      token: device.token,
      device_name: device.name,
      backup_paths: device.backup_paths ?? defaultPaths,
      schedule_cron: device.schedule_cron ?? '',
    }, null, 2)

    // Install script (Windows)
    const installCmd = platform === 'windows'
      ? `@echo off\r\nhomenas-agent.exe --install\r\necho Instalación completada. El agente ya está funcionando en segundo plano.\r\npause\r\n`
      : `#!/bin/bash\nchmod +x homenas-agent-${platform === 'mac' ? 'mac-arm64' : 'linux'}\nsudo ./homenas-agent-${platform === 'mac' ? 'mac-arm64' : 'linux'} --install\necho "Agente instalado correctamente."\n`

    const zipName = `homenas-agent-${device.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${platform}.zip`

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${zipName}"`)

    const archive = archiver('zip', { zlib: { level: 1 } })
    const pass = new PassThrough()
    archive.pipe(pass)

    archive.file(binaryPath, { name: binaryName })
    archive.append(configJSON, { name: 'homenas-agent.json' })
    archive.append(
      platform === 'windows' ? installCmd : installCmd,
      { name: platform === 'windows' ? 'instalar.cmd' : 'instalar.sh' }
    )
    archive.append(
      platform === 'windows'
        ? `HomeNas Active Backup Agent\r\n============================\r\n\r\n1. Haz clic derecho en "instalar.cmd"\r\n2. Selecciona "Ejecutar como administrador"\r\n3. Listo. El agente se instala en segundo plano y no aparece en ningún sitio.\r\n\r\nPara desinstalar: homenas-agent.exe --uninstall (como administrador)\r\n`
        : `HomeNas Active Backup Agent\n===========================\n\n1. Ejecuta: sudo bash instalar.sh\n2. Listo.\n`,
      { name: 'LEEME.txt' }
    )

    await archive.finalize()
    return reply.send(pass)
  })

  // ── Admin: restore — download file ─────────────────────────────────────────

  fastify.get<{ Params: { id: string }; Querystring: { version?: string; path?: string } }>(
    '/devices/:id/restore/download', {
      preHandler: [requireAuth, requireAdmin],
    }, async (request, reply) => {
      const deviceId = parseInt(request.params.id, 10)
      if (isNaN(deviceId)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device ID' })
      const { version, path: filePath } = request.query
      if (!version || !filePath) return reply.status(400).send({ error: 'Bad Request', message: 'version and path required' })

      const service = createActiveBackupService(fastify.db)
      try {
        const fullPath = service.getRestoreFilePath(deviceId, version, filePath)
        const stat = statSync(fullPath)
        const filename = basename(fullPath)
        reply.header('Content-Disposition', `attachment; filename="${filename}"`)
        reply.header('Content-Length', stat.size)
        reply.header('Content-Type', 'application/octet-stream')
        return reply.send(createReadStream(fullPath))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        const status = message === 'File not found' ? 404 : message === 'Path traversal not allowed' ? 403 : 400
        return reply.status(status).send({ error: 'Error', message })
      }
    }
  )
}
