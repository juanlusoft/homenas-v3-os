import { useState } from 'react'
import { HardDrive, Plus } from 'lucide-react'
import type { BackupJob } from '@homenas/shared'
import { useBackupJobs, useBackupProgress } from '../../hooks/useBackup'
import { BackupJobCard } from './BackupJobsCard'
import { BackupProgressCard } from './BackupProgressCard'
import { BackupJobForm } from './BackupJobForm'
import { BackupHistoryModal } from './BackupHistoryModal'
import { useT } from '../../i18n/useT'

export function BackupView() {
  const t = useT()
  const { data: jobs, isLoading: jobsLoading, error: jobsError } = useBackupJobs()
  const { data: progress } = useBackupProgress()

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<BackupJob | null>(null)
  const [historyTarget, setHistoryTarget] = useState<BackupJob | null>(null)

  const isRunning = progress?.running ?? false

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.backup.title}</h1>
          <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.backup.subtitle}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t.backup.newJob}
        </button>
      </div>

      {/* Active run progress */}
      {progress && isRunning && jobs && (
        <BackupProgressCard progress={progress} jobs={jobs} />
      )}

      {/* Job list */}
      {jobsLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-5 space-y-3 animate-pulse">
              <div className="h-5 bg-black/10 dark:bg-white/10 rounded w-2/3" />
              <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-full" />
              <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-4/5" />
            </div>
          ))}
        </div>
      )}

      {jobsError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <p className="text-red-600 dark:text-red-400 text-sm">Failed to load backup jobs</p>
        </div>
      )}

      {jobs && jobs.length === 0 && (
        <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-12 text-center">
          <HardDrive className="w-10 h-10 text-gray-400 dark:text-white/20 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-white/40 text-sm">No backup jobs configured yet</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create your first job
          </button>
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {jobs.map((job) => (
            <BackupJobCard
              key={job.id}
              job={job}
              isRunning={isRunning}
              onEdit={setEditTarget}
              onHistory={setHistoryTarget}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && <BackupJobForm onClose={() => setShowCreate(false)} />}
      {editTarget && <BackupJobForm job={editTarget} onClose={() => setEditTarget(null)} />}
      {historyTarget && <BackupHistoryModal job={historyTarget} onClose={() => setHistoryTarget(null)} />}
    </div>
  )
}
