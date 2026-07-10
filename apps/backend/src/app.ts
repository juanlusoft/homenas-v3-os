import Fastify, { FastifyError } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import staticPlugin from '@fastify/static'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import dbPlugin from './plugins/db.plugin.js'
import authPlugin from './plugins/auth.plugin.js'
import rbacPlugin from './plugins/rbac.plugin.js'
import { authRoutes } from './routes/auth/index.js'
import { systemRoutes } from './routes/system/index.js'
import { storageRoutes } from './routes/storage/index.js'
import { dockerRoutes } from './routes/docker/index.js'
import { networkRoutes } from './routes/network/index.js'
import { usersRoutes } from './routes/users/index.js'
import { schedulerRoutes } from './routes/scheduler/index.js'
import { backupRoutes } from './routes/backup/index.js'
import { setupRoutes } from './routes/setup/index.js'
import { homestoreRoutes } from './routes/homestore/index.js'
import { containersRoutes } from './routes/containers/index.js'
import { syncthingRoutes } from './routes/syncthing/index.js'
import { cloudBackupRoutes } from './routes/cloud-backup/index.js'
import { filesRoutes } from './routes/files/index.js'
import { networkDrivesRoutes } from './routes/network-drives/index.js'
import { ddnsRoutes } from './routes/ddns/index.js'
import { updatesRoutes } from './routes/updates/index.js'
import { notificationsRoutes } from './routes/notifications/index.js'
import { startDdnsUpdater } from './services/ddns.service.js'
import { logError } from './lib/log-store.js'

interface HttpsOptions {
  cert: Buffer
  key: Buffer
}

function buildLogger() {
  const level = process.env.LOG_LEVEL ?? 'info'
  if (process.env.NODE_ENV !== 'production') {
    return { level }
  }
  // In production: write JSON logs to rotating file AND stdout
  const logsDir = join(process.cwd(), '..', '..', 'logs')
  try { mkdirSync(logsDir, { recursive: true }) } catch { /* ok */ }
  return {
    level,
    transport: {
      targets: [
        {
          target: 'pino/file',
          options: { destination: 1 }, // stdout (fd 1)
          level,
        },
        {
          target: 'pino-roll',
          options: {
            file: join(logsDir, 'homenas.log'),
            size: '10m',      // rotate at 10 MB
            limit: { count: 3 }, // keep 3 rotated files
            dateFormat: false,
          },
          level,
        },
      ],
    },
  }
}

export function buildApp(httpsOptions?: HttpsOptions) {
  const app = Fastify({
    logger: buildLogger(),
    bodyLimit: 1 * 1024 * 1024, // 1 MB — files use their own multipart limit
    ...(httpsOptions ? { https: httpsOptions } : {}),
  })

  // Security headers
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind inlines styles
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow iframes from same origin (file previews)
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
    },
  })

  // CORS for development (allow Vite dev server)
  app.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })

  // Global rate limit — brute-force protection
  app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  })

  // 1. Database plugin
  app.register(dbPlugin)

  // 2. Auth plugin (requires db)
  app.register(authPlugin)

  // 3. RBAC plugin (requires auth)
  app.register(rbacPlugin)

  // 4. Auth routes
  app.register(authRoutes, { prefix: '/api/auth' })

  // 5. System routes
  app.register(systemRoutes, { prefix: '/api/system' })

  // 6. Storage routes
  app.register(storageRoutes, { prefix: '/api/storage' })

  // 7. Docker routes
  app.register(dockerRoutes, { prefix: '/api/docker' })

  // 8. Network routes
  app.register(networkRoutes, { prefix: '/api/network' })

  // 9. Users routes
  app.register(usersRoutes, { prefix: '/api/users' })

  // 11. Scheduler routes
  app.register(schedulerRoutes, { prefix: '/api/scheduler' })

  // 12. Backup routes
  app.register(backupRoutes, { prefix: '/api/backup' })

  // 13. Setup routes
  app.register(setupRoutes, { prefix: '/api/setup' })

  // 14. HomeStore (Docker App Store)
  app.register(homestoreRoutes, { prefix: '/api/homestore' })

  // 14.b Container edit (PATCH /api/containers/:id) — operates on
  // HomeStore-installed containers but exposed under its own prefix per spec.
  app.register(containersRoutes, { prefix: '/api/containers' })

  // 17. Syncthing (P2P sync)
  app.register(syncthingRoutes, { prefix: '/api/syncthing' })

  // 18. Cloud Backup (rclone)
  app.register(cloudBackupRoutes, { prefix: '/api/cloud-backup' })

  // 19. File Manager
  app.register(filesRoutes, { prefix: '/api/files' })

  // 20. Network Drives (rclone FUSE mounts)
  app.register(networkDrivesRoutes, { prefix: '/api/network-drives' })

  // 21. DDNS
  app.register(ddnsRoutes, { prefix: '/api/ddns' })

  // 21. System Updates
  app.register(updatesRoutes, { prefix: '/api/updates' })

  // 22. Notifications (email + Telegram alert configuration)
  app.register(notificationsRoutes, { prefix: '/api/notifications' })

  // 23. Health route — no version leak
  app.get('/api/health', async () => ({ status: 'ok' }))

  // Start DDNS background updater after DB is ready
  app.addHook('onReady', async () => {
    startDdnsUpdater(app.db)
  })

  // 23. Serve frontend static files in production
  if (process.env.NODE_ENV === 'production') {
    const frontendDist = join(process.cwd(), '..', 'frontend', 'dist')
    if (existsSync(frontendDist)) {
      app.register(staticPlugin, { root: frontendDist, prefix: '/' })
      app.setNotFoundHandler((_request, reply) => {
        return reply.sendFile('index.html')
      })
    }
  }

  // Normalize error responses
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const statusCode = err.statusCode ?? 500
    if (statusCode >= 500) {
      app.log.error(err)
      logError('server', err.message, { url: request.url, method: request.method, stack: err.stack })
      return reply.status(statusCode).send({ error: 'Internal Server Error', message: 'An unexpected error occurred' })
    }
    if (statusCode >= 400) {
      logError('server', err.message, { url: request.url, method: request.method, statusCode })
    }
    return reply.status(statusCode).send({ error: err.name ?? 'Error', message: err.message })
  })

  return app
}
