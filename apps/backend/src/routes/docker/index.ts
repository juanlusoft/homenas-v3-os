import type { FastifyInstance } from 'fastify'
import { ContainerActionSchema, ComposeActionSchema } from '@homenas/shared'
import {
  listContainers,
  containerAction,
  getContainerLogs,
  listComposeStacks,
  composeAction,
  getComposeProgress,
} from '../../services/docker.service.js'

export async function dockerRoutes(fastify: FastifyInstance) {
  const { requireAuth, requireAdmin } = fastify

  // GET /api/docker/containers
  fastify.get('/containers', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const containers = await listContainers()
    return reply.send(containers)
  })

  // POST /api/docker/containers/action
  fastify.post('/containers/action', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = ContainerActionSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }

    const { containerId, action } = result.data

    try {
      await containerAction(containerId, action)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Internal Server Error', message })
    }

    return reply.send({ success: true })
  })

  // GET /api/docker/containers/:id/logs
  fastify.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    '/containers/:id/logs',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params
      const rawLines = parseInt(request.query.lines ?? '200', 10)
      const lines = Math.min(isNaN(rawLines) ? 200 : rawLines, 5000)

      // Validate id
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || id.length > 64) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid container id' })
      }

      try {
        const logs = await getContainerLogs(id, lines)
        return reply.send({ logs })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.status(500).send({ error: 'Internal Server Error', message })
      }
    }
  )

  // GET /api/docker/stacks
  fastify.get('/stacks', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const stacks = await listComposeStacks()
    return reply.send(stacks)
  })

  // POST /api/docker/stacks/action
  fastify.post('/stacks/action', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = ComposeActionSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }

    const { path, action } = result.data

    try {
      const started = await composeAction(path, action)
      return reply.send(started)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const status = message.includes('disallowed') || message.includes('blocked') || message.includes('privileged') || message.includes('capability') || message.includes('not allowed') ? 403 : 409
      return reply.status(status).send({ error: 'Conflict', message })
    }
  })

  // GET /api/docker/stacks/progress
  fastify.get('/stacks/progress', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    return reply.send(getComposeProgress())
  })
}
