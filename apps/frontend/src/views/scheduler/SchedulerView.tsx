import { useState } from 'react'
import { Calendar, Plus, Play, Pencil, Trash2, Clock, CheckCircle, XCircle, Minus } from 'lucide-react'
import { useSchedulerTasks, useDeleteTask, useToggleTask, useRunTaskNow } from '../../hooks/useScheduler'
import { TaskForm } from './TaskForm'
import type { ScheduledTask } from '@homenas/shared'
import { useT } from '../../i18n/useT'

function formatUnixDate(ts: number | null): string {
  if (!ts) return 'Never'
  return new Date(ts * 1000).toLocaleString()
}

function ExitCodeBadge({ code }: { code: number | null }) {
  if (code === null) return <span className="text-gray-400 dark:text-white/30 text-xs">—</span>
  if (code === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
        <CheckCircle className="w-3 h-3" />
        exit 0
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
      <XCircle className="w-3 h-3" />
      exit {code}
    </span>
  )
}

interface TaskCardProps {
  task: ScheduledTask
  onEdit: (task: ScheduledTask) => void
  onDelete: (task: ScheduledTask) => void
}

function TaskCard({ task, onEdit, onDelete }: TaskCardProps) {
  const toggleTask = useToggleTask()
  const runNow = useRunTaskNow()
  const t = useT()

  return (
    <div className="bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 rounded-xl p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white truncate">{task.name}</h3>
            {task.enabled ? (
              <span className="text-xs text-green-700 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded shrink-0">{t.common.active}</span>
            ) : (
              <span className="text-xs text-gray-400 dark:text-white/30 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded shrink-0">{t.common.disabled}</span>
            )}
          </div>
          {task.description && (
            <p className="text-sm text-gray-500 dark:text-white/40 mt-1 truncate">{task.description}</p>
          )}
        </div>

        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={task.enabled}
          onClick={() => toggleTask.mutate(task.id)}
          disabled={toggleTask.isPending}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            task.enabled ? 'bg-indigo-600' : 'bg-white/20'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            task.enabled ? 'translate-x-4' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {/* Cron + command */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-gray-400 dark:text-white/30 shrink-0" />
          <code className="text-xs text-indigo-700 dark:text-indigo-300 font-mono bg-indigo-500/10 px-2 py-0.5 rounded">
            {task.cronExpression}
          </code>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-xs text-gray-400 dark:text-white/30 shrink-0 mt-0.5">cmd</span>
          <code className="text-xs text-gray-700 dark:text-white/70 font-mono break-all">
            {task.command}{task.args.length > 0 ? ' ' + task.args.join(' ') : ''}
          </code>
        </div>
      </div>

      {/* Last run info */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-400 dark:text-white/30 mb-0.5">{t.scheduler.lastRun}</p>
          <p className="text-gray-600 dark:text-white/60">{formatUnixDate(task.lastRun)}</p>
        </div>
        <div>
          <p className="text-gray-400 dark:text-white/30 mb-0.5">{t.scheduler.exitCode}</p>
          <ExitCodeBadge code={task.lastExitCode} />
        </div>
        <div>
          <p className="text-gray-400 dark:text-white/30 mb-0.5">{t.scheduler.nextRun}</p>
          <p className="text-gray-600 dark:text-white/60">{task.enabled ? formatUnixDate(task.nextRun) : '—'}</p>
        </div>
      </div>

      {/* Last output (collapsed) */}
      {task.lastOutput && (
        <details className="group">
          <summary className="text-xs text-gray-400 dark:text-white/30 cursor-pointer hover:text-gray-500 dark:text-white/50 transition-colors select-none">
            {t.scheduler.lastOutput}
          </summary>
          <pre className="mt-2 text-xs text-gray-500 dark:text-white/50 font-mono bg-black/30 rounded-lg p-3 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
            {task.lastOutput}
          </pre>
        </details>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-black/5 dark:border-white/5">
        <button
          onClick={() => runNow.mutate(task.id)}
          disabled={runNow.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-white/60 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
        >
          <Play className="w-3 h-3" />
          {t.common.runNow}
        </button>
        <button
          onClick={() => onEdit(task)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-white/60 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <Pencil className="w-3 h-3" />
          {t.common.edit}
        </button>
        <button
          onClick={() => onDelete(task)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-white/40 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
        >
          <Trash2 className="w-3 h-3" />
          {t.common.delete}
        </button>
      </div>
    </div>
  )
}

export function SchedulerView() {
  const { data: tasks, isLoading, error } = useSchedulerTasks()
  const deleteTask = useDeleteTask()
  const t = useT()

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<ScheduledTask | null>(null)

  const handleDelete = (task: ScheduledTask) => {
    if (!window.confirm(`Delete task "${task.name}"? This cannot be undone.`)) return
    deleteTask.mutate(task.id)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.scheduler.title}</h1>
          <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.scheduler.subtitle}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t.scheduler.newTask}
        </button>
      </div>

      {/* Task list */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-5 space-y-3 animate-pulse">
              <div className="h-5 bg-black/10 dark:bg-white/10 rounded w-2/3" />
              <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-full" />
              <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-4/5" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <p className="text-red-600 dark:text-red-400 text-sm">{t.scheduler.failedToLoad}</p>
        </div>
      )}

      {tasks && tasks.length === 0 && (
        <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-12 text-center">
          <Calendar className="w-10 h-10 text-gray-400 dark:text-white/20 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-white/40 text-sm">{t.scheduler.noTasksYet}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t.scheduler.createFirst}
          </button>
        </div>
      )}

      {tasks && tasks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={setEditTarget}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && <TaskForm onClose={() => setShowCreate(false)} />}
      {editTarget && <TaskForm task={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  )
}
