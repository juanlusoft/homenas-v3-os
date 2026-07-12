import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import * as nodeCron from 'node-cron'
import { type ScheduledTask as CronJob } from 'node-cron'
import { CronExpressionParser } from 'cron-parser'
import type { Database } from 'better-sqlite3'
import { createSchedulerRepo } from '../repositories/scheduler.repo.js'
import type { CreateTaskInput, UpdateTaskInput, ScheduledTask } from '@homenas/shared'

const execFileAsync = promisify(execFile)

// Map of task id → scheduled cron job
const activeJobs = new Map<number, CronJob>()

// Allowlist of commands that scheduled tasks are allowed to run. Anything
// else is rejected at validation time, before reaching execFile.
//
// Rationale: even though execFile doesn't spawn a shell, the binary itself
// can be a shell (`bash -c "rm -rf /"`), `sudo`, `python -c "..."`, or any
// interpreter — turning the scheduler into an admin → root RCE. The
// allowlist restricts tasks to backup/maintenance binaries that are safe
// to expose to admin users.
//
// The allowlist matches the basename of the binary, so both `rsync` and
// `/usr/bin/rsync` are accepted; `/bin/bash` is rejected.
//
// Override via env var HOMENAS_SCHEDULER_ALLOWED_COMMANDS (comma-separated).
const DEFAULT_ALLOWED_COMMANDS = new Set<string>([
  // backup / sync
  'rsync', 'rclone', 'restic', 'borg', 'duplicity', 'snapraid', 'snapraid-runner',
  'btrbk', 'snapper', 'syncthing', 'unison',
  // filesystem maintenance
  'btrfs', 'zfs', 'zpool', 'mdadm', 'fstrim', 'e2fsck', 'xfs_repair',
  // monitoring (read-only mostly)
  'smartctl', 'hdparm', 'df', 'du', 'find', 'stat',
])

const ALLOWED_COMMANDS = (() => {
  const override = process.env['HOMENAS_SCHEDULER_ALLOWED_COMMANDS']
  if (!override) return DEFAULT_ALLOWED_COMMANDS
  return new Set(override.split(',').map((c) => c.trim()).filter(Boolean))
})()

// Per-command argument flags that turn an otherwise read-only/allowlisted
// binary into an arbitrary-command-execution primitive. Allowlisting the binary
// is NOT enough: `find -exec`, `rsync --rsh`, `snapraid -F` (pre/post hooks via
// config) etc. run attacker-controlled commands as root (sudo NOPASSWD).
const ARG_BLOCKED_PREFIXES: Record<string, string[]> = {
  find: ['-exec', '-execdir', '-ok', '-okdir', '-fprintf', '-fprint', '-fprint0', '-delete'],
  rsync: ['-e', '--rsh', '--rsync-path', '--remote-option', '--copy-dest', '--compare-dest'],
  rclone: ['--rc', '--rc-'],
}

function assertCommandAllowed(command: string, args: readonly string[] = []): void {
  if (typeof command !== 'string' || !command) {
    throw new Error('Scheduler command is required')
  }
  // Basename guards against `/bin/bash` (rejected) while accepting `/usr/bin/rsync`
  // and bare `rsync`. We forbid path separators in the basename to block
  // attempts like `bash\0rsync` or unicode lookalikes — basename sanitises.
  const name = basename(command)
  if (!ALLOWED_COMMANDS.has(name)) {
    throw new Error(
      `Scheduler command "${name}" is not in the allowlist. ` +
      `Allowed: ${[...ALLOWED_COMMANDS].sort().join(', ')}`,
    )
  }
  const blocked = ARG_BLOCKED_PREFIXES[name] ?? []
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.includes('\0')) {
      throw new Error('Invalid scheduler argument')
    }
    for (const prefix of blocked) {
      if (arg === prefix || arg.startsWith(`${prefix}=`) || arg.startsWith(`${prefix} `)) {
        throw new Error(`Scheduler argument not allowed for ${name}: ${prefix}`)
      }
    }
  }
}

function computeNextRun(cronExpression: string): number | null {
  // Real next-run calculation using cron-parser. Returns Unix seconds, or null
  // if the expression is invalid (cron-parser throws synchronously).
  try {
    if (!nodeCron.validate(cronExpression)) return null
    const iter = CronExpressionParser.parse(cronExpression, { tz: 'UTC' })
    const next = iter.next().getTime()
    return Math.floor(next / 1000)
  } catch {
    return null
  }
}

function toScheduledTask(record: ReturnType<ReturnType<typeof createSchedulerRepo>['findById']> & object, cronExpression: string): ScheduledTask {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    cronExpression: record.cronExpression,
    command: record.command,
    args: record.args,
    enabled: record.enabled,
    lastRun: record.lastRun,
    lastExitCode: record.lastExitCode,
    lastOutput: record.lastOutput,
    nextRun: record.enabled ? computeNextRun(cronExpression) : null,
    createdAt: record.createdAt,
  }
}

export function createSchedulerService(db: Database) {
  const repo = createSchedulerRepo(db)

  function scheduleTask(taskId: number, cronExpression: string, command: string, args: string[]) {
    // Cancel existing job if any
    const existing = activeJobs.get(taskId)
    if (existing) {
      existing.stop()
      activeJobs.delete(taskId)
    }

    if (!nodeCron.validate(cronExpression)) return

    const job = nodeCron.schedule(cronExpression, async () => {
      const startTime = Math.floor(Date.now() / 1000)
      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          timeout: 5 * 60 * 1000, // 5 minute timeout
          maxBuffer: 1024 * 1024,  // 1MB output limit
        })
        const output = (stdout + stderr).slice(0, 65535)
        repo.updateRunResult(taskId, startTime, 0, output)
      } catch (err: unknown) {
        const exitCode = (err as NodeJS.ErrnoException & { code?: number }).code ?? 1
        const output = ((err as { stdout?: string }).stdout ?? '') + ((err as { stderr?: string }).stderr ?? '')
        repo.updateRunResult(taskId, startTime, typeof exitCode === 'number' ? exitCode : 1, output.slice(0, 65535))
      }
    })

    activeJobs.set(taskId, job)
  }

  function unscheduleTask(taskId: number) {
    const job = activeJobs.get(taskId)
    if (job) {
      job.stop()
      activeJobs.delete(taskId)
    }
  }

  function recordToTask(record: NonNullable<ReturnType<ReturnType<typeof createSchedulerRepo>['findById']>>): ScheduledTask {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      cronExpression: record.cronExpression,
      command: record.command,
      args: record.args,
      enabled: record.enabled,
      lastRun: record.lastRun,
      lastExitCode: record.lastExitCode,
      lastOutput: record.lastOutput,
      nextRun: record.enabled ? computeNextRun(record.cronExpression) : null,
      createdAt: record.createdAt,
    }
  }

  return {
    /** Load all enabled tasks from DB and schedule them. Call on startup.
     * Tasks whose command is no longer in the allowlist are skipped + logged
     * (defensive against allowlist tightening between deploys). */
    initialize() {
      const tasks = repo.list()
      for (const task of tasks) {
        if (!task.enabled) continue
        try {
          assertCommandAllowed(task.command, task.args)
        } catch (err) {
          console.warn(`[scheduler] skipping disallowed task ${task.id} (${task.name}):`, (err as Error).message)
          continue
        }
        scheduleTask(task.id, task.cronExpression, task.command, task.args)
      }
    },

    listTasks(): ScheduledTask[] {
      return repo.list().map(recordToTask)
    },

    createTask(input: CreateTaskInput): ScheduledTask {
      assertCommandAllowed(input.command, input.args)
      const record = repo.create({
        name: input.name,
        description: input.description,
        cronExpression: input.cronExpression,
        command: input.command,
        args: input.args,
        enabled: input.enabled,
      })

      if (record.enabled) {
        scheduleTask(record.id, record.cronExpression, record.command, record.args)
      }

      return recordToTask(record)
    },

    updateTask(id: number, input: UpdateTaskInput): ScheduledTask {
      const existing = repo.findById(id)
      if (!existing) throw new Error('Task not found')

      // Allowlist check on the new command (or the existing one if the update
      // doesn't change it — both must remain in the allowlist).
      const effectiveCommand = input.command ?? existing.command
      assertCommandAllowed(effectiveCommand, input.args ?? existing.args)

      const updated = repo.update(id, {
        name: input.name,
        description: input.description,
        cronExpression: input.cronExpression,
        command: input.command,
        args: input.args,
        enabled: input.enabled,
      })

      if (!updated) throw new Error('Task not found after update')

      // Re-schedule with new settings
      unscheduleTask(id)
      if (updated.enabled) {
        scheduleTask(updated.id, updated.cronExpression, updated.command, updated.args)
      }

      return recordToTask(updated)
    },

    deleteTask(id: number): void {
      const existing = repo.findById(id)
      if (!existing) throw new Error('Task not found')
      unscheduleTask(id)
      repo.delete(id)
    },

    toggleTask(id: number): ScheduledTask {
      const existing = repo.findById(id)
      if (!existing) throw new Error('Task not found')

      const newEnabled = !existing.enabled
      repo.setEnabled(id, newEnabled)

      if (newEnabled) {
        scheduleTask(id, existing.cronExpression, existing.command, existing.args)
      } else {
        unscheduleTask(id)
      }

      const updated = repo.findById(id)!
      return recordToTask(updated)
    },

    async runNow(id: number): Promise<ScheduledTask> {
      const task = repo.findById(id)
      if (!task) throw new Error('Task not found')
      assertCommandAllowed(task.command, task.args)

      const startTime = Math.floor(Date.now() / 1000)
      try {
        const { stdout, stderr } = await execFileAsync(task.command, task.args, {
          timeout: 5 * 60 * 1000,
          maxBuffer: 1024 * 1024,
        })
        const output = (stdout + stderr).slice(0, 65535)
        repo.updateRunResult(id, startTime, 0, output)
      } catch (err: unknown) {
        const exitCode = (err as NodeJS.ErrnoException & { code?: number }).code ?? 1
        const output = ((err as { stdout?: string }).stdout ?? '') + ((err as { stderr?: string }).stderr ?? '')
        repo.updateRunResult(id, startTime, typeof exitCode === 'number' ? exitCode : 1, output.slice(0, 65535))
      }

      const updated = repo.findById(id)!
      return recordToTask(updated)
    },

    shutdown() {
      for (const [, job] of activeJobs) {
        job.stop()
      }
      activeJobs.clear()
    },
  }
}
