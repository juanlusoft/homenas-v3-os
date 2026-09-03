import type { FastifyInstance } from 'fastify'
import { StartSnapRaidSchema, StartBadblocksSchema, MountDiskInputSchema, CreatePoolInputSchema, BulkAddToPoolInputSchema, CacheDrainConfigSchema } from '@homenas/shared'
import {
  listDisks,
  getIoStats,
  getSnapRaidStatus,
  startSnapRaid,
  stopSnapRaid,
  getMergerFSStatus,
  drainMergerFSCache,
  getCacheDrainStatus,
  setCacheDrainConfig,
  getBadblocksStatus,
  startBadblocks,
  stopBadblocks,
} from '../../services/storage.service.js'
import {
  getDiskPartitions,
  mountPartitionReadOnly,
  unmountBrowse,
  addDiskToPool,
  bulkAddToPool,
  createPool,
} from '../../services/disk-manage.service.js'

// Device names come from URL params and are interpolated into /dev/<name>,
// which is then handed to partitioning/mount tools running as root. Restrict
// to plain kernel block-device names (sda, sdb1, nvme0n1p2, mmcblk0...) so
// path tricks like "../mnt/storage/x" can never reach those tools.
const DEVICE_NAME_RE = /^[a-z][a-z0-9]*$/

function isValidDeviceName(name: string): boolean {
  return DEVICE_NAME_RE.test(name)
}

export async function storageRoutes(fastify: FastifyInstance) {
  const { requireAuth, requireAdmin } = fastify

  // GET /api/storage/disks
  fastify.get('/disks', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const disks = await listDisks()
    return reply.send(disks)
  })

  // GET /api/storage/disks/iostats — real-time R/W MB/s per disk
  fastify.get<{ Querystring: { disks?: string } }>('/disks/iostats', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const diskIds = (request.query.disks ?? '').split(',').map(d => d.trim()).filter(Boolean)
    if (diskIds.length === 0) return reply.send({ disks: [] })
    return reply.send({ disks: getIoStats(diskIds) })
  })

  // GET /api/storage/snapraid/status
  fastify.get('/snapraid/status', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    return reply.send(getSnapRaidStatus())
  })

  // POST /api/storage/snapraid/start
  fastify.post('/snapraid/start', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = StartSnapRaidSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }

    const { operation } = result.data
    startSnapRaid(operation)
    return reply.send({ started: true, operation })
  })

  // POST /api/storage/snapraid/stop
  fastify.post('/snapraid/stop', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    stopSnapRaid()
    return reply.send({ stopped: true })
  })

  // GET /api/storage/mergerfs/status
  fastify.get('/mergerfs/status', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const status = await getMergerFSStatus()
    return reply.send(status)
  })

  // POST /api/storage/mergerfs/drain — move cache disk contents to data disk
  fastify.post('/mergerfs/drain', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    try {
      await drainMergerFSCache()
      return reply.send({ ok: true })
    } catch (err) {
      return reply.status(500).send({ error: 'Storage Error', message: (err as Error).message })
    }
  })

  // GET /api/storage/mergerfs/drain-config
  fastify.get('/mergerfs/drain-config', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    return reply.send(getCacheDrainStatus())
  })

  // POST /api/storage/mergerfs/drain-config
  fastify.post('/mergerfs/drain-config', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = CacheDrainConfigSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    setCacheDrainConfig(result.data)
    return reply.send(getCacheDrainStatus())
  })

  // GET /api/storage/badblocks/status
  fastify.get('/badblocks/status', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    return reply.send(getBadblocksStatus())
  })

  // POST /api/storage/badblocks/start
  fastify.post('/badblocks/start', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = StartBadblocksSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }

    const { device, writeMode } = result.data

    try {
      startBadblocks(device, writeMode)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(400).send({ error: 'Bad Request', message })
    }

    return reply.send({ started: true, device, writeMode })
  })

  // POST /api/storage/badblocks/stop
  fastify.post('/badblocks/stop', {
    preHandler: [requireAuth, requireAdmin],
  }, async (_request, reply) => {
    stopBadblocks()
    return reply.send({ stopped: true })
  })

  // GET /api/storage/disks/:device/partitions
  fastify.get<{ Params: { device: string } }>('/disks/:device/partitions', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!isValidDeviceName(request.params.device)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device name' })
    }
    const device = `/dev/${request.params.device}`
    try {
      const partitions = await getDiskPartitions(device)
      return reply.send(partitions)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(400).send({ error: 'Bad Request', message })
    }
  })

  // POST /api/storage/disks/:device/mount
  fastify.post<{ Params: { device: string } }>('/disks/:device/mount', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!isValidDeviceName(request.params.device)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device name' })
    }
    const device = `/dev/${request.params.device}`
    const result = MountDiskInputSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      const mountResult = await mountPartitionReadOnly(device, result.data.browserId)
      return reply.send(mountResult)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Storage Error', message })
    }
  })

  // POST /api/storage/disks/:device/unmount
  fastify.post<{ Params: { device: string } }>('/disks/:device/unmount', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const result = MountDiskInputSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      await unmountBrowse(result.data.browserId)
      return reply.send({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Storage Error', message })
    }
  })

  // POST /api/storage/disks/:device/add-to-pool
  fastify.post<{ Params: { device: string } }>('/disks/:device/add-to-pool', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    if (!isValidDeviceName(request.params.device)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid device name' })
    }
    const device = `/dev/${request.params.device}`
    try {
      const addResult = await addDiskToPool(device)
      return reply.send(addResult)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Storage Error', message })
    }
  })

  // POST /api/storage/pool/bulk-add — format + add multiple disks to existing pool in parallel
  fastify.post('/pool/bulk-add', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = BulkAddToPoolInputSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      const addResult = await bulkAddToPool(result.data.devices)
      return reply.send({ results: addResult })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Storage Error', message })
    }
  })

  // POST /api/storage/pool/create
  fastify.post('/pool/create', {
    preHandler: [requireAuth, requireAdmin],
  }, async (request, reply) => {
    const result = CreatePoolInputSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad Request', message: result.error.message })
    }
    try {
      const poolResult = await createPool(result.data.devices)
      return reply.send(poolResult)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.status(500).send({ error: 'Storage Error', message })
    }
  })
}
