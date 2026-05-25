import { useState, useMemo } from 'react'
import {
  Play, Square, RotateCcw, ScrollText, RefreshCw, Trash2, Download, Pencil,
} from 'lucide-react'
import {
  useHomeCatalog,
  useInstallApp,
  useUninstallApp,
  useStartApp,
  useStopApp,
  useRestartApp,
  useUpdateApp,
  useAppLogs,
} from '../../hooks/useHomeStore'
import type { CatalogApp, AppCategory, PortMapping, VolumeMapping, EnvVar, InstallPayload } from '@homenas/shared'
import { useT } from '../../i18n/useT'
import {
  PortsField,
  VolumesField,
  EnvVarsField,
  ContainerEditModal,
} from '../../components/container-form'

// ─── App icon ────────────────────────────────────────────────────────────────

function AppIcon({ icon, name, size = 'md' }: { icon: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'w-10 h-10' : size === 'sm' ? 'w-6 h-6' : 'w-8 h-8'
  const isUrl = icon.startsWith('http')
  if (isUrl) {
    return (
      <img
        src={icon}
        alt={name}
        className={`${sizeClass} object-contain rounded`}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return <span className={size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-2xl'}>{icon}</span>
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE_CLASSES: Record<string, { className: string }> = {
  running:      { className: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30' },
  stopped:      { className: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border border-yellow-500/30' },
  installing:   { className: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30' },
  updating:     { className: 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30' },
  error:        { className: 'bg-red-500/20 text-red-700 dark:text-red-300 border border-red-500/30' },
  notInstalled: { className: 'bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/40 border border-black/10 dark:border-white/10' },
}

function StatusBadge({ status }: { status: string }) {
  const t = useT()
  const labels: Record<string, string> = {
    running:      t.homestore.running,
    stopped:      t.homestore.stopped,
    installing:   t.homestore.installing,
    updating:     t.homestore.updating,
    error:        t.common.error,
    notInstalled: t.homestore.notInstalled,
  }
  const cfg = STATUS_BADGE_CLASSES[status] ?? STATUS_BADGE_CLASSES.notInstalled!
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.className}`}>
      {labels[status] ?? t.homestore.notInstalled}
    </span>
  )
}

// ─── Category colors ──────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Media:       'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  Networking:  'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  Monitoring:  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  Development: 'bg-orange-500/15 text-orange-300',
  Storage:     'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  Automation:  'bg-lime-500/15 text-lime-300',
  Security:    'bg-red-500/15 text-red-700 dark:text-red-300',
  Download:    'bg-pink-500/15 text-pink-300',
}

// ─── Install Modal ────────────────────────────────────────────────────────────

interface InstallModalProps {
  app: CatalogApp
  onClose: () => void
  onInstall: (payload: InstallPayload) => void
  loading: boolean
}

function InstallModal({ app, onClose, onInstall, loading }: InstallModalProps) {
  const t = useT()
  const [ports, setPorts] = useState<PortMapping[]>(app.defaultPorts.map(p => ({ ...p })))
  const [volumes, setVolumes] = useState<VolumeMapping[]>(app.defaultVolumes.map(v => ({ ...v })))
  const [envVars, setEnvVars] = useState<EnvVar[]>(app.defaultEnvVars.map(e => ({ ...e })))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onInstall({ ports, volumes, envVars, restartPolicy: 'unless-stopped', extraArgs: [] })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <AppIcon icon={app.icon} name={app.name} size="md" />
            <div>
              <h2 className="text-gray-900 dark:text-white font-semibold text-lg">{t.homestore.install} {app.name}</h2>
              <p className="text-gray-500 dark:text-white/40 text-sm">{app.dockerImage}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 transition-colors p-1.5 rounded-lg hover:bg-black/5 dark:bg-white/5"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Ports */}
            {ports.length > 0 && (
              <section>
                <h3 className="text-gray-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">{t.homestore.portMappings}</h3>
                <PortsField
                  value={ports}
                  onChange={setPorts}
                  allowAddRemove={false}
                  lockContainerSide
                  containerLabel={t.homestore.containerPort}
                  getRowLabel={(p, i) => p.label ?? t.homestore.portHost(i + 1)}
                  idPrefix={`install-${app.id}-ports`}
                />
              </section>
            )}

            {/* Volumes */}
            {volumes.length > 0 && (
              <section>
                <h3 className="text-gray-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">{t.homestore.volumes}</h3>
                <VolumesField
                  value={volumes}
                  onChange={setVolumes}
                  allowAddRemove={false}
                  lockContainerSide
                  showMode={false}
                  getRowLabel={(v, i) => v.label ?? t.homestore.volumeHost(i + 1)}
                  idPrefix={`install-${app.id}-volumes`}
                />
              </section>
            )}

            {/* Env vars */}
            {envVars.length > 0 && (
              <section>
                <h3 className="text-gray-600 dark:text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">{t.homestore.envVars}</h3>
                <EnvVarsField
                  value={envVars}
                  onChange={setEnvVars}
                  allowAddRemove={false}
                  lockKey
                  getRowLabel={(e) => e.label ?? e.key}
                  valuePlaceholder={t.homestore.valuePlaceholder}
                  secretPlaceholder={t.homestore.secretPlaceholder}
                  idPrefix={`install-${app.id}-env`}
                />
              </section>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-black/10 dark:border-white/10 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-white/60 hover:text-gray-700 dark:hover:text-white/80 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {loading ? t.homestore.installing : t.common.install}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Logs Modal ───────────────────────────────────────────────────────────────

interface LogsModalProps {
  app: CatalogApp
  onClose: () => void
  onRefresh: () => void
}

function LogsModal({ app, onClose, onRefresh }: LogsModalProps) {
  const t = useT()
  const { data, isLoading, error } = useAppLogs(app.id)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <AppIcon icon={app.icon} name={app.name} size="sm" />
            <div>
              <h2 className="text-gray-900 dark:text-white font-semibold">{t.homestore.logsFor(app.name)}</h2>
              <p className="text-gray-500 dark:text-white/40 text-xs">{t.homestore.last500Lines}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="px-3 py-1.5 text-xs text-gray-600 dark:text-white/60 hover:text-gray-700 dark:hover:text-white/80 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg transition-colors"
            >
              {t.common.refresh}
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 transition-colors p-1.5 rounded-lg hover:bg-black/5 dark:bg-white/5"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Log content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-gray-500 dark:text-white/40 text-sm">{t.homestore.loadingLogs}</div>
          )}
          {error && (
            <div className="text-red-600 dark:text-red-400 text-sm p-4 bg-red-500/10 rounded-lg border border-red-500/20">
              {t.homestore.failedToLoadLogs} {error instanceof Error ? error.message : t.common.unknown}
            </div>
          )}
          {data && (
            <pre className="text-xs text-gray-700 dark:text-white/70 font-mono whitespace-pre-wrap leading-5">
              {data.logs || t.homestore.noOutput}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Uninstall Confirm Modal ──────────────────────────────────────────────────

interface UninstallModalProps {
  app: CatalogApp
  onClose: () => void
  onConfirm: (removeData: boolean) => void
  loading: boolean
}

function UninstallModal({ app, onClose, onConfirm, loading }: UninstallModalProps) {
  const t = useT()
  const [removeData, setRemoveData] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-6 py-4 border-b border-black/10 dark:border-white/10">
          <h2 className="text-gray-900 dark:text-white font-semibold text-lg">{t.homestore.uninstallTitle(app.name)}</h2>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-gray-600 dark:text-white/60 text-sm">
            {t.homestore.uninstallDesc}
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={removeData}
              onChange={e => setRemoveData(e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
            <span className="text-sm text-gray-700 dark:text-white/70">{t.homestore.alsoDeleteData}</span>
          </label>
          {removeData && (
            <p className="text-red-600 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {t.homestore.deleteDataWarning}
            </p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-black/10 dark:border-white/10 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-white/60 hover:text-gray-700 dark:hover:text-white/80 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 border border-black/10 dark:border-white/10 rounded-lg transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={() => onConfirm(removeData)}
            disabled={loading}
            className="px-5 py-2 text-sm font-medium text-gray-900 dark:text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {loading ? t.common.remove : t.common.uninstall}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── App Card ─────────────────────────────────────────────────────────────────

interface AppCardProps {
  app: CatalogApp
  onInstall: (app: CatalogApp) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
  onUninstall: (app: CatalogApp) => void
  onUpdate: (id: string) => void
  onLogs: (app: CatalogApp) => void
  onEdit: (app: CatalogApp) => void
  pendingId: string | null
}

function AppCard({
  app,
  onInstall,
  onStart,
  onStop,
  onRestart,
  onUninstall,
  onUpdate,
  onLogs,
  onEdit,
  pendingId,
}: AppCardProps) {
  const t = useT()
  const isPending = pendingId === app.id
  const isInstalled = app.status !== 'notInstalled'
  const isRunning = app.status === 'running'
  const isStopped = app.status === 'stopped' || app.status === 'error'

  return (
    <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-5 flex flex-col gap-4 hover:border-white/20 transition-colors">
      {/* Top row: icon + name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AppIcon icon={app.icon} name={app.name} size="lg" />
          <div className="min-w-0">
            <h3 className="text-gray-900 dark:text-white font-semibold text-sm truncate">{app.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[app.category] ?? 'bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/40'}`}>
              {app.category}
            </span>
          </div>
        </div>
        <StatusBadge status={app.status} />
      </div>

      {/* Description */}
      <p className="text-gray-500 dark:text-white/50 text-xs leading-5 line-clamp-2">{app.description}</p>

      {/* Web URL if running */}
      {isRunning && app.webUrl && (() => {
        const realUrl = app.webUrl.replace('localhost', window.location.hostname)
        return (
          <a
            href={realUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 text-xs font-mono transition-colors"
          >
            {realUrl} ↗
          </a>
        )
      })()}

      {/* Actions */}
      <div className="flex items-center gap-1.5 mt-auto">
        {!isInstalled && (
          <button
            onClick={() => onInstall(app)}
            disabled={isPending}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {t.common.install}
          </button>
        )}

        {isInstalled && isStopped && (
          <button
            onClick={() => onStart(app.id)}
            disabled={isPending}
            title={t.common.start}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-600 dark:text-emerald-400 disabled:opacity-50 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}

        {isRunning && (
          <>
            <button
              onClick={() => onStop(app.id)}
              disabled={isPending}
              title={t.common.stop}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/20 hover:bg-amber-500/40 text-amber-600 dark:text-amber-400 disabled:opacity-50 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onRestart(app.id)}
              disabled={isPending}
              title={t.common.restart}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        {isInstalled && (
          <>
            <button
              onClick={() => onLogs(app)}
              title={t.common.logs}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 transition-colors"
            >
              <ScrollText className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onEdit(app)}
              disabled={isPending}
              title={t.common.edit}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 disabled:opacity-50 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onUpdate(app.id)}
              disabled={isPending}
              title={t.common.update}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-indigo-500/10 text-gray-500 dark:text-white/50 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onUninstall(app)}
              disabled={isPending}
              title={t.common.uninstall}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-red-500/10 text-gray-500 dark:text-white/50 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────

const ALL_CATEGORIES: AppCategory[] = [
  'Media', 'Download', 'Storage', 'Networking', 'Security',
  'Monitoring', 'Automation', 'Development',
]

export function HomeStoreView() {
  const t = useT()
  const { data: catalog, isLoading, error, refetch } = useHomeCatalog()

  const installApp  = useInstallApp()
  const uninstallApp = useUninstallApp()
  const startApp    = useStartApp()
  const stopApp     = useStopApp()
  const restartApp  = useRestartApp()
  const updateApp   = useUpdateApp()

  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<AppCategory | 'All'>('All')
  const [installTarget, setInstallTarget] = useState<CatalogApp | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<CatalogApp | null>(null)
  const [logsTarget, setLogsTarget] = useState<CatalogApp | null>(null)
  const [editingApp, setEditingApp] = useState<CatalogApp | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [logsKey, setLogsKey] = useState(0)

  // Error / success feedback
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null)

  const showToast = (message: string, type: 'error' | 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  // Filtered apps
  const filtered = useMemo(() => {
    if (!catalog) return []
    return catalog.filter(app => {
      const matchesCategory = activeCategory === 'All' || app.category === activeCategory
      const matchesSearch = !search || app.name.toLowerCase().includes(search.toLowerCase()) ||
        app.description.toLowerCase().includes(search.toLowerCase())
      return matchesCategory && matchesSearch
    })
  }, [catalog, activeCategory, search])

  const handleInstall = (app: CatalogApp) => setInstallTarget(app)

  const handleInstallConfirm = async (payload: InstallPayload) => {
    if (!installTarget) return
    const id = installTarget.id
    setInstallTarget(null)
    setPendingId(id)
    try {
      await installApp.mutateAsync({ id, payload })
      showToast(t.homestore.installSuccess(installTarget.name), 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.homestore.installFailed, 'error')
    } finally {
      setPendingId(null)
    }
  }

  const handleStart = async (id: string) => {
    setPendingId(id)
    try {
      await startApp.mutateAsync(id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.homestore.startFailed, 'error')
    } finally {
      setPendingId(null)
    }
  }

  const handleStop = async (id: string) => {
    setPendingId(id)
    try {
      await stopApp.mutateAsync(id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.homestore.stopFailed, 'error')
    } finally {
      setPendingId(null)
    }
  }

  const handleRestart = async (id: string) => {
    setPendingId(id)
    try {
      await restartApp.mutateAsync(id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.homestore.restartFailed, 'error')
    } finally {
      setPendingId(null)
    }
  }

  const handleUninstall = (app: CatalogApp) => setUninstallTarget(app)

  const handleUninstallConfirm = async (removeData: boolean) => {
    if (!uninstallTarget) return
    const id = uninstallTarget.id
    const name = uninstallTarget.name
    setUninstallTarget(null)
    setPendingId(id)
    try {
      await uninstallApp.mutateAsync({ id, payload: { removeData } })
      showToast(t.homestore.uninstallSuccess(name), 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.homestore.uninstallFailed, 'error')
    } finally {
      setPendingId(null)
    }
  }

  const handleUpdate = async (id: string) => {
    setPendingId(id)
    try {
      await updateApp.mutateAsync(id)
      showToast(t.homestore.updateComplete, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.homestore.updateFailed, 'error')
    } finally {
      setPendingId(null)
    }
  }

  const handleLogs = (app: CatalogApp) => setLogsTarget(app)

  const handleEdit = (app: CatalogApp) => setEditingApp(app)

  const handleEditSaved = () => {
    // Refresh the catalog using the same mechanism the install/uninstall flows
    // rely on. The mutation hook already invalidates the catalog query, but we
    // call refetch() too in case the user has the modal open across a stale
    // window — gives an immediate visual update.
    refetch()
    showToast(t.containerEdit.successRecreated, 'success')
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.homestore.title}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.homestore.subtitle}</p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          placeholder={t.homestore.searchPlaceholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 dark:text-white/30 focus:outline-none focus:border-indigo-500"
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveCategory('All')}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              activeCategory === 'All'
                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-700 dark:text-indigo-300'
                : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 hover:bg-white/8'
            }`}
          >
            {t.common.all}
          </button>
          {ALL_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                activeCategory === cat
                  ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-700 dark:text-indigo-300'
                  : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 hover:bg-white/8'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-48 text-gray-500 dark:text-white/40 text-sm">
          {t.homestore.loadingCatalog}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4 flex items-center justify-between">
          <p className="text-red-600 dark:text-red-400 text-sm">{t.homestore.failedToLoad} {error instanceof Error ? error.message : t.common.unknown}</p>
          <button
            onClick={() => refetch()}
            className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300 underline"
          >
            {t.homestore.retry}
          </button>
        </div>
      )}

      {/* App grid */}
      {!isLoading && !error && catalog && (
        <>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 dark:text-white/30 text-sm">
              {t.homestore.noAppsFound}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  onInstall={handleInstall}
                  onStart={handleStart}
                  onStop={handleStop}
                  onRestart={handleRestart}
                  onUninstall={handleUninstall}
                  onUpdate={handleUpdate}
                  onLogs={handleLogs}
                  onEdit={handleEdit}
                  pendingId={pendingId}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Install Modal */}
      {installTarget && (
        <InstallModal
          app={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstall={handleInstallConfirm}
          loading={installApp.isPending}
        />
      )}

      {/* Uninstall Modal */}
      {uninstallTarget && (
        <UninstallModal
          app={uninstallTarget}
          onClose={() => setUninstallTarget(null)}
          onConfirm={handleUninstallConfirm}
          loading={uninstallApp.isPending}
        />
      )}

      {/* Logs Modal */}
      {logsTarget && (
        <LogsModal
          key={logsKey}
          app={logsTarget}
          onClose={() => setLogsTarget(null)}
          onRefresh={() => setLogsKey(k => k + 1)}
        />
      )}

      {/* Edit Modal */}
      {editingApp && (
        <ContainerEditModal
          container={editingApp}
          isOpen
          onClose={() => setEditingApp(null)}
          onSaved={() => {
            handleEditSaved()
            setEditingApp(null)
          }}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium border transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-900/90 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-900/90 border-red-500/30 text-red-800 dark:text-red-200'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
