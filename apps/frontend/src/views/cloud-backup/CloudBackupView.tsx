import { useState, useEffect } from 'react'
import {
  Cloud,
  Download,
  Plus,
  Trash2,
  Play,
  XCircle,
  CheckCircle,
  AlertCircle,
  Clock,
  HardDrive,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import {
  useCloudBackupStatus,
  useInstallRclone,
  useCloudRemotes,
  useDeleteRemote,
  useConfigureRemote,
  useCloudJobs,
  useCreateCloudJob,
  useDeleteCloudJob,
  useRunCloudJob,
  useUpdateCloudJob,
  useTransferProgress,
  useCancelTransfer,
  useTransferHistory,
  useRemoteInfo,
} from '../../hooks/useCloudBackup'
import type { CloudRemote, CloudJob, CloudTransfer, RemoteType, JobOperation } from '../../api/cloud-backup'
import { useT } from '../../i18n/useT'

// ─── Constants ────────────────────────────────────────────────────────────────

const REMOTE_TYPES: { value: RemoteType; label: string; icon: string }[] = [
  { value: 'gdrive', label: 'Google Drive', icon: '🟢' },
  { value: 'dropbox', label: 'Dropbox', icon: '🔵' },
  { value: 'onedrive', label: 'OneDrive', icon: '🟦' },
  { value: 's3', label: 'Amazon S3', icon: '🟠' },
  { value: 'b2', label: 'Backblaze B2', icon: '🔴' },
  { value: 'mega', label: 'MEGA', icon: '🔴' },
  { value: 'sftp', label: 'SFTP', icon: '🖥️' },
  { value: 'ftp', label: 'FTP', icon: '📁' },
  { value: 'webdav', label: 'WebDAV', icon: '🌐' },
]

const REMOTE_CONFIG_FIELDS: Record<RemoteType, Array<{ key: string; label: string; type?: string; placeholder?: string }>> = {
  gdrive: [
    { key: 'client_id', label: 'Client ID', placeholder: 'OAuth Client ID (leave blank to use rclone default)' },
    { key: 'client_secret', label: 'Client Secret', type: 'password', placeholder: 'OAuth Client Secret' },
    { key: 'scope', label: 'Scope', placeholder: 'drive (full), drive.file, drive.readonly' },
  ],
  dropbox: [
    { key: 'client_id', label: 'App Key', placeholder: 'Dropbox App Key' },
    { key: 'client_secret', label: 'App Secret', type: 'password', placeholder: 'Dropbox App Secret' },
  ],
  onedrive: [
    { key: 'client_id', label: 'Client ID', placeholder: 'Azure App Client ID' },
    { key: 'client_secret', label: 'Client Secret', type: 'password', placeholder: 'Azure App Client Secret' },
    { key: 'tenant', label: 'Tenant', placeholder: 'common (or your tenant ID)' },
  ],
  s3: [
    { key: 'provider', label: 'Provider', placeholder: 'AWS, Minio, Wasabi, DigitalOcean, etc.' },
    { key: 'access_key_id', label: 'Access Key ID', placeholder: 'AWS_ACCESS_KEY_ID' },
    { key: 'secret_access_key', label: 'Secret Access Key', type: 'password', placeholder: 'AWS_SECRET_ACCESS_KEY' },
    { key: 'region', label: 'Region', placeholder: 'us-east-1' },
    { key: 'endpoint', label: 'Endpoint', placeholder: 'Leave blank for AWS, or custom S3 endpoint' },
    { key: 'bucket', label: 'Bucket', placeholder: 'my-bucket' },
  ],
  b2: [
    { key: 'account', label: 'Account ID', placeholder: 'Backblaze Account ID' },
    { key: 'key', label: 'Application Key', type: 'password', placeholder: 'Backblaze Application Key' },
  ],
  mega: [
    { key: 'user', label: 'Email', placeholder: 'MEGA account email' },
    { key: 'pass', label: 'Password', type: 'password', placeholder: 'MEGA account password' },
  ],
  sftp: [
    { key: 'host', label: 'Host', placeholder: '192.168.1.100' },
    { key: 'port', label: 'Port', placeholder: '22' },
    { key: 'user', label: 'Username', placeholder: 'admin' },
    { key: 'pass', label: 'Password', type: 'password', placeholder: 'Password (or leave blank for key auth)' },
    { key: 'key_file', label: 'SSH Key File', placeholder: '/root/.ssh/id_rsa' },
  ],
  ftp: [
    { key: 'host', label: 'Host', placeholder: 'ftp.example.com' },
    { key: 'port', label: 'Port', placeholder: '21' },
    { key: 'user', label: 'Username', placeholder: 'ftpuser' },
    { key: 'pass', label: 'Password', type: 'password', placeholder: 'FTP password' },
  ],
  webdav: [
    { key: 'url', label: 'URL', placeholder: 'https://webdav.example.com/dav' },
    { key: 'vendor', label: 'Vendor', placeholder: 'nextcloud, owncloud, sharepoint, other' },
    { key: 'user', label: 'Username', placeholder: 'username' },
    { key: 'pass', label: 'Password', type: 'password', placeholder: 'Password' },
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function formatDate(unix: number | null): string {
  if (!unix) return '—'
  return new Date(unix * 1000).toLocaleString()
}

function formatDuration(startedAt: number, finishedAt: number | null): string {
  if (!finishedAt) return '—'
  const secs = finishedAt - startedAt
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

function remoteIcon(type: RemoteType): string {
  return REMOTE_TYPES.find((r) => r.value === type)?.icon ?? '☁️'
}

function remoteLabel(type: RemoteType): string {
  return REMOTE_TYPES.find((r) => r.value === type)?.label ?? type
}

function statusColor(status: string): string {
  switch (status) {
    case 'success': return 'text-emerald-600 dark:text-emerald-400'
    case 'error': return 'text-red-600 dark:text-red-400'
    case 'running': return 'text-indigo-600 dark:text-indigo-400'
    case 'cancelled': return 'text-yellow-600 dark:text-yellow-400'
    default: return 'text-gray-500 dark:text-white/40'
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'success': return 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
    case 'error': return 'bg-red-500/20 text-red-600 dark:text-red-400'
    case 'running': return 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'
    case 'cancelled': return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
    default: return 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/40'
  }
}

// ─── Remote Row (with delete confirmation) ────────────────────────────────────

function RemoteRow({ remote }: { remote: CloudRemote }) {
  const deleteRemote = useDeleteRemote()
  const [confirmDeleteRemote, setConfirmDeleteRemote] = useState<string | null>(null)

  // Auto-clear confirmation state after 5s to avoid lingering "danger" UI
  useEffect(() => {
    if (confirmDeleteRemote === null) return
    const timer = setTimeout(() => setConfirmDeleteRemote(null), 5_000)
    return () => clearTimeout(timer)
  }, [confirmDeleteRemote])

  const isConfirming = confirmDeleteRemote === remote.name

  return (
    <div
      className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4 flex items-center gap-4"
    >
      <span className="text-2xl shrink-0">{remoteIcon(remote.type)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{remote.name}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/50">
            {remoteLabel(remote.type)}
          </span>
        </div>
        <RemoteInfoPill name={remote.name} />
      </div>
      {isConfirming ? (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              deleteRemote.mutate(remote.name)
              setConfirmDeleteRemote(null)
            }}
            disabled={deleteRemote.isPending}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
            title="Confirmar eliminación"
          >
            Confirmar eliminación
          </button>
          <button
            onClick={() => setConfirmDeleteRemote(null)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/40 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDeleteRemote(remote.name)}
          disabled={deleteRemote.isPending}
          className="p-1.5 rounded-lg text-gray-400 dark:text-white/30 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
          title="Delete remote"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// ─── Remote Info Pill ─────────────────────────────────────────────────────────

function RemoteInfoPill({ name }: { name: string }) {
  const { data: info, isLoading } = useRemoteInfo(name)

  if (isLoading) {
    return <span className="text-xs text-gray-400 dark:text-white/20 animate-pulse">Loading storage…</span>
  }
  if (!info || info.total === null) {
    return <span className="text-xs text-gray-400 dark:text-white/20">Storage unknown</span>
  }

  const usedPct = info.total > 0 ? Math.round(((info.used ?? 0) / info.total) * 100) : 0
  return (
    <span className="text-xs text-gray-500 dark:text-white/40">
      {formatBytes(info.used)} / {formatBytes(info.total)} used ({usedPct}%)
    </span>
  )
}

// ─── Add Remote Modal ─────────────────────────────────────────────────────────

function AddRemoteModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<RemoteType>('gdrive')
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const configureRemote = useConfigureRemote()

  const fields = REMOTE_CONFIG_FIELDS[type] ?? []

  const updateField = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanConfig: Record<string, string> = {}
    for (const [k, v] of Object.entries(config)) {
      if (v.trim()) cleanConfig[k] = v.trim()
    }
    try {
      await configureRemote.mutateAsync({ name: name.trim(), type, config: cleanConfig })
      onClose()
    } catch {
      // shown below
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-2xl p-6 w-full max-w-lg my-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-5">Add Remote</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type selector */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Provider</label>
            <div className="grid grid-cols-3 gap-2">
              {REMOTE_TYPES.map((rt) => (
                <button
                  key={rt.value}
                  type="button"
                  onClick={() => { setType(rt.value); setConfig({}) }}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs transition-colors ${
                    type === rt.value
                      ? 'border-indigo-500 bg-indigo-500/20 text-white'
                      : 'border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/50 hover:border-white/20'
                  }`}
                >
                  <span className="text-lg">{rt.icon}</span>
                  <span>{rt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Remote Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-gdrive"
              pattern="[a-zA-Z0-9_-]+"
              title="Alphanumeric, dashes and underscores only"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          {/* Dynamic config fields */}
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">{field.label}</label>
              <input
                type={field.type ?? 'text'}
                value={config[field.key] ?? ''}
                onChange={(e) => updateField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}

          {configureRemote.error && (
            <p className="text-xs text-red-600 dark:text-red-400">{String(configureRemote.error)}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={configureRemote.isPending}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {configureRemote.isPending ? 'Saving…' : 'Save Remote'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Add Job Modal ────────────────────────────────────────────────────────────

function AddJobModal({
  remotes,
  job,
  onClose,
}: {
  remotes: CloudRemote[]
  job?: CloudJob
  onClose: () => void
}) {
  const createJob = useCreateCloudJob()
  const updateJob = useUpdateCloudJob()
  const isEdit = !!job

  const [name, setName] = useState(job?.name ?? '')
  const [remoteId, setRemoteId] = useState<number | ''>(job?.remote_id ?? (remotes[0]?.id ?? ''))
  const [operation, setOperation] = useState<JobOperation>(job?.operation ?? 'sync')
  const [source, setSource] = useState(job?.source ?? '')
  const [destination, setDestination] = useState(job?.destination ?? '')
  const [cronExpression, setCronExpression] = useState(job?.cron_expression ?? '')
  const [enabled, setEnabled] = useState(job?.enabled !== 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (remoteId === '') return
    try {
      if (isEdit && job) {
        await updateJob.mutateAsync({
          id: job.id,
          input: {
            name: name.trim(),
            operation,
            source: source.trim(),
            destination: destination.trim(),
            cron_expression: cronExpression.trim() || null,
            enabled: enabled ? 1 : 0,
          },
        })
      } else {
        await createJob.mutateAsync({
          name: name.trim(),
          remote_id: remoteId,
          operation,
          source: source.trim(),
          destination: destination.trim(),
          cron_expression: cronExpression.trim() || null,
          enabled: enabled ? 1 : 0,
        })
      }
      onClose()
    } catch {
      // shown below
    }
  }

  const isPending = createJob.isPending || updateJob.isPending
  const error = createJob.error ?? updateJob.error

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-2xl p-6 w-full max-w-md my-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-5">{isEdit ? 'Edit Job' : 'New Backup Job'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Job Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nightly backup"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Remote</label>
              <select
                value={remoteId}
                onChange={(e) => setRemoteId(Number(e.target.value))}
                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
                required
              >
                <option value="" disabled>Select a remote…</option>
                {remotes.map((r) => (
                  <option key={r.id} value={r.id} className="bg-gray-900">
                    {remoteIcon(r.type)} {r.name} ({remoteLabel(r.type)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Operation</label>
            <div className="flex gap-2">
              {(['sync', 'copy', 'move'] as JobOperation[]).map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => setOperation(op)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${
                    operation === op
                      ? 'bg-indigo-600 text-white'
                      : 'bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/40 hover:bg-black/10 dark:bg-white/10'
                  }`}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Source</label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="/data/documents"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Destination</label>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="my-gdrive:backups/documents"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">
              Cron Schedule <span className="text-gray-400 dark:text-white/20">(optional)</span>
            </label>
            <input
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="0 2 * * *  (daily at 2am)"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`transition-colors ${enabled ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-white/30'}`}
            >
              {enabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
            </button>
            <span className="text-sm text-gray-600 dark:text-white/60">Enabled</span>
          </label>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{String(error)}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Remotes Tab ──────────────────────────────────────────────────────────────

function RemotesTab() {
  const t = useT()
  const { data: remotes, isLoading, error } = useCloudRemotes()
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-white/40">
          {remotes ? t.cloudBackup.remotes(remotes.length) : ''}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.cloudBackup.addRemote}
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4 animate-pulse h-16" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
          {t.cloudBackup.failedToLoad}
        </div>
      )}

      {remotes && remotes.length === 0 && (
        <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-8 text-center">
          <Cloud className="w-8 h-8 text-gray-400 dark:text-white/20 mx-auto mb-2" />
          <p className="text-sm text-gray-400 dark:text-white/30">{t.cloudBackup.noRemotes}</p>
        </div>
      )}

      {remotes && remotes.length > 0 && (
        <div className="space-y-2">
          {remotes.map((remote: CloudRemote) => (
            <RemoteRow key={remote.id} remote={remote} />
          ))}
        </div>
      )}

      {showAdd && <AddRemoteModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ─── Jobs Tab ─────────────────────────────────────────────────────────────────

function JobsTab() {
  const t = useT()
  const { data: jobs, isLoading, error } = useCloudJobs()
  const { data: remotes } = useCloudRemotes()
  const { data: progress } = useTransferProgress()
  const deleteJob = useDeleteCloudJob()
  const runJob = useRunCloudJob()
  const [showAdd, setShowAdd] = useState(false)
  const [editJob, setEditJob] = useState<CloudJob | null>(null)

  const getRemoteName = (remoteId: number): string => {
    const r = remotes?.find((rem) => rem.id === remoteId)
    return r ? `${remoteIcon(r.type)} ${r.name}` : `Remote #${remoteId}`
  }

  const isTransferRunning = progress?.running ?? false

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-white/40">
          {jobs ? `${jobs.length} job${jobs.length !== 1 ? 's' : ''}` : ''}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.cloudBackup.addJob}
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
          {t.cloudBackup.failedToLoad}
        </div>
      )}

      {jobs && jobs.length === 0 && (
        <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-8 text-center">
          <HardDrive className="w-8 h-8 text-gray-400 dark:text-white/20 mx-auto mb-2" />
          <p className="text-sm text-gray-400 dark:text-white/30">{t.cloudBackup.noJobs}</p>
        </div>
      )}

      {jobs && jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job: CloudJob) => (
            <div
              key={job.id}
              className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{job.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${statusBg(job.last_status)}`}>
                      {job.last_status}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/50 capitalize">
                      {job.operation}
                    </span>
                    {!job.enabled && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">Disabled</span>
                    )}
                  </div>

                  <div className="mt-1.5 space-y-0.5 text-xs text-gray-500 dark:text-white/40">
                    <p>
                      <span className="text-gray-400 dark:text-white/20">Remote:</span> {getRemoteName(job.remote_id)}
                    </p>
                    <p className="font-mono truncate">
                      <span className="text-gray-400 dark:text-white/20 font-sans">From:</span> {job.source}
                    </p>
                    <p className="font-mono truncate">
                      <span className="text-gray-400 dark:text-white/20 font-sans">To:</span> {job.destination}
                    </p>
                    {job.cron_expression && (
                      <p className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {job.cron_expression}
                      </p>
                    )}
                    {job.last_run && (
                      <p>Last run: {formatDate(job.last_run)}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setEditJob(job)}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-white/30 hover:text-gray-700 dark:text-white/70 hover:bg-black/10 dark:bg-white/10 transition-colors"
                    title="Edit job"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => runJob.mutate(job.id)}
                    disabled={isTransferRunning || runJob.isPending}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-white/30 hover:text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-30"
                    title="Run now"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteJob.mutate(job.id)}
                    disabled={deleteJob.isPending}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-white/30 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete job"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && remotes && (
        <AddJobModal remotes={remotes} onClose={() => setShowAdd(false)} />
      )}
      {editJob && remotes && (
        <AddJobModal remotes={remotes} job={editJob} onClose={() => setEditJob(null)} />
      )}
    </div>
  )
}

// ─── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const { data: transfers, isLoading, error } = useTransferHistory()
  const { data: jobs } = useCloudJobs()
  const { data: progress } = useTransferProgress()
  const cancelTransfer = useCancelTransfer()

  const getJobName = (jobId: number): string => {
    const j = jobs?.find((job) => job.id === jobId)
    return j ? j.name : `Job #${jobId}`
  }

  const isRunning = progress?.running ?? false

  return (
    <div className="space-y-4">
      {/* Active transfer */}
      {isRunning && progress && (
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                Transfer running — {getJobName(progress.jobId!)}
              </span>
            </div>
            <button
              onClick={() => cancelTransfer.mutate()}
              disabled={cancelTransfer.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-white/40">
              <span>Progress</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>

          {/* Output lines */}
          {progress.outputLines.length > 0 && (
            <div className="bg-black/30 rounded-lg p-3 font-mono text-xs text-gray-500 dark:text-white/50 space-y-0.5 max-h-32 overflow-y-auto">
              {progress.outputLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4 animate-pulse h-14" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
          Failed to load transfer history
        </div>
      )}

      {transfers && transfers.length === 0 && !isRunning && (
        <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-8 text-center">
          <Clock className="w-8 h-8 text-gray-400 dark:text-white/20 mx-auto mb-2" />
          <p className="text-sm text-gray-400 dark:text-white/30">No transfers yet</p>
        </div>
      )}

      {transfers && transfers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 dark:text-white/30 border-b border-black/5 dark:border-white/5">
                <th className="pb-2 pr-4 font-medium">Job</th>
                <th className="pb-2 pr-4 font-medium">Started</th>
                <th className="pb-2 pr-4 font-medium">Duration</th>
                <th className="pb-2 pr-4 font-medium">Transferred</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {transfers.map((t: CloudTransfer) => (
                <tr key={t.id} className="text-gray-600 dark:text-white/60">
                  <td className="py-2.5 pr-4">
                    <span className="text-white/80">{getJobName(t.job_id)}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-xs whitespace-nowrap">{formatDate(t.started_at)}</td>
                  <td className="py-2.5 pr-4 text-xs whitespace-nowrap">
                    {formatDuration(t.started_at, t.finished_at)}
                  </td>
                  <td className="py-2.5 pr-4 text-xs">{formatBytes(t.transferred_bytes)}</td>
                  <td className="py-2.5">
                    <span className={`inline-flex items-center gap-1 text-xs ${statusColor(t.status)}`}>
                      {t.status === 'success' && <CheckCircle className="w-3 h-3" />}
                      {t.status === 'error' && <XCircle className="w-3 h-3" />}
                      {t.status === 'running' && <RefreshCw className="w-3 h-3 animate-spin" />}
                      {t.status === 'cancelled' && <AlertCircle className="w-3 h-3" />}
                      <span className="capitalize">{t.status}</span>
                    </span>
                    {t.error_message && (
                      <p className="text-xs text-red-600 dark:text-red-400/60 mt-0.5 max-w-xs truncate" title={t.error_message}>
                        {t.error_message}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────

type Tab = 'remotes' | 'jobs' | 'history'

export function CloudBackupView() {
  const t = useT()
  const [tab, setTab] = useState<Tab>('remotes')
  const { data: status, isLoading: statusLoading } = useCloudBackupStatus()
  const install = useInstallRclone()

  const installed = status?.installed ?? false

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'remotes', label: t.cloudBackup.destinations },
    { value: 'jobs', label: t.cloudBackup.jobs },
    { value: 'history', label: t.cloudBackup.history },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.cloudBackup.title}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.cloudBackup.subtitle}</p>
      </div>

      {/* Status card */}
      <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl p-5">
        {statusLoading ? (
          <div className="flex items-center gap-3 animate-pulse">
            <div className="w-10 h-10 rounded-xl bg-black/10 dark:bg-white/10" />
            <div className="space-y-2">
              <div className="h-4 bg-black/10 dark:bg-white/10 rounded w-32" />
              <div className="h-3 bg-black/10 dark:bg-white/10 rounded w-48" />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                <Cloud className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">rclone</span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                      installed
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                        : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/40'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${installed ? 'bg-emerald-400' : 'bg-white/30'}`} />
                    {installed ? t.homestore.installed : t.cloudBackup.notInstalled}
                  </span>
                </div>
                {installed && status?.version && (
                  <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">Version {status.version}</p>
                )}
              </div>
            </div>

            {!installed && (
              <button
                onClick={() => install.mutate()}
                disabled={install.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                <Download className="w-4 h-4" />
                {install.isPending ? `${t.common.loading}` : t.cloudBackup.installRclone}
              </button>
            )}
          </div>
        )}

        {install.error && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            <XCircle className="w-3.5 h-3.5" />
            {String(install.error)}
          </div>
        )}
      </div>

      {/* Tabs — show regardless so user can see the state */}
      <div className="flex gap-1 bg-black/5 dark:bg-white/5 rounded-xl p-1 w-fit">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.value}
            onClick={() => setTab(tabItem.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === tabItem.value
                ? 'bg-indigo-600 text-white'
                : 'text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70'
            }`}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {!installed && tab !== 'history' && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-700 dark:text-yellow-300">{t.cloudBackup.installToStart}</p>
        </div>
      )}

      {tab === 'remotes' && <RemotesTab />}
      {tab === 'jobs' && <JobsTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  )
}
