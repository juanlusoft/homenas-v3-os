import type { FastifyInstance } from 'fastify'
import { CreateBackupJobSchema } from '@homenas/shared'
import { createBackupService } from '../../services/backup.service.js'

export async function backupRoutes(fastify: FastifyInstance) {
  const { requireAuth, requireAdmin } = fastify

  // GET /api/backup/jobs — list all backup jobs [any authenticated user]
  fastify.get('/jobs', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const service = createBackupService(fastify.db)
    return reply.send(service.listJobs())
  })

  // POST /api/backup/jobs — create a backup job [admin only]
  fastify.post('/jobs', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = CreateBackupJobSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }

    const service = createBackupService(fastify.db)
    try {
      const job = service.createJob(result.data)
      return reply.status(201).send(job)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(400).send({ error: 'Bad Request', message })
    }
  })

  // PUT /api/backup/jobs/:id — update a backup job [admin only]
  fastify.put('/jobs/:id', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const jobId = parseInt(id, 10)
    if (isNaN(jobId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid job ID' })
    }

    const result = CreateBackupJobSchema.partial().safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }

    const service = createBackupService(fastify.db)
    try {
      const job = service.updateJob(jobId, result.data)
      return reply.send(job)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Job not found' ? 404 : 400
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Bad Request', message })
    }
  })

  // DELETE /api/backup/jobs/:id — delete a backup job [admin only]
  fastify.delete('/jobs/:id', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const jobId = parseInt(id, 10)
    if (isNaN(jobId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid job ID' })
    }

    const service = createBackupService(fastify.db)
    try {
      service.deleteJob(jobId)
      return reply.send({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Job not found' ? 404 : 400
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Bad Request', message })
    }
  })

  // POST /api/backup/jobs/:id/run — start a backup job [admin only]
  fastify.post('/jobs/:id/run', {
    preHandler: [requireAuth, requireAdmin],
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const jobId = parseInt(id, 10)
    if (isNaN(jobId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid job ID' })
    }

    const service = createBackupService(fastify.db)
    try {
      const result = service.runJob(jobId)
      return reply.status(202).send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message === 'Job not found' ? 404 : 409
      return reply.status(status).send({ error: status === 404 ? 'Not Found' : 'Conflict', message })
    }
  })

  // GET /api/backup/progress — get current running backup progress [any authenticated user]
  fastify.get('/progress', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const service = createBackupService(fastify.db)
    return reply.send(service.getProgress())
  })

  // GET /api/backup/jobs/:id/history — get run history for a job [any authenticated user]
  fastify.get('/jobs/:id/history', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const jobId = parseInt(id, 10)
    if (isNaN(jobId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid job ID' })
    }

    const service = createBackupService(fastify.db)
    return reply.send(service.getHistory(jobId))
  })

  // POST /api/backup/cancel — cancel running backup [admin only]
  fastify.post('/cancel', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    const service = createBackupService(fastify.db)
    try {
      service.cancelJob()
      return reply.send({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(409).send({ error: 'Conflict', message })
    }
  })
}
