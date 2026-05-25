import { useState, useEffect } from 'react'
import {
  ShieldCheck,
  HardDrive,
  Clock,
  Trash2,
  Play,
  StopCircle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  FolderOpen,
  RefreshCw,
  FileText,
  Folder,
  Info,
  Server,
  Download,
  Plus,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type { AbDevice, AbBackupRun, AbFileEntry } from '@homenas/shared'
import {
  useAbDevices,
  useAbDevice,
  useAbProgress,
  useAbVersions,
  useAbBrowse,
  useApproveDevice,
  useDeleteDevice,
  useTriggerBackup,
  useCancelBackup,
  useCreateDevice,
} from '../../hooks/useActiveBackup'
import type { VersionEntry } from '../../api/active-backup'
import { activeBackupApi } from '../../api/active-backup'
import { useT } from '../../i18n/useT'

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AbDevice['status'], { label: string; color: string; icon: React.ReactNode }> = {
  pending:  { label: 'Pending',  color: 'text-amber-600 dark:text-amber-400 bg-amber-400/10 border-amber-400/20',  icon: <Clock className="w-3 h-3" /> },
  approved: { label: 'Approved', color: 'text-blue-600 dark:text-blue-400 bg-blue-400/10 border-blue-400/20',    icon: <CheckCircle2 className="w-3 h-3" /> },
  active:   { label: 'Active',   color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-400/10 border-emerald-400/20', icon: <CheckCircle2 className="w-3 h-3" /> },
  error:    { label: 'Error',    color: 'text-red-600 dark:text-red-400 bg-red-400/10 border-red-400/20',        icon: <XCircle className="w-3 h-3" /> },
  offline:  { label: 'Offline',  color: 'text-gray-600 dark:text-gray-400 bg-gray-400/10 border-gray-400/20',    icon: <AlertCircle className="w-3 h-3" /> },
}

function StatusBadge({ status }: { status: AbDevice['status'] }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', cfg.color)}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

// ─── Run status badge ─────────────────────────────────────────────────────────

const RUN_STATUS: Record<AbBackupRun['status'], { label: string; color: string }> = {
  running:   { label: 'Running',   color: 'text-blue-600 dark:text-blue-400' },
  success:   { label: 'Success',   color: 'text-emerald-600 dark:text-emerald-400' },
  error:     { label: 'Error',     color: 'text-red-600 dark:text-red-400' },
  cancelled: { label: 'Cancelled', color: 'text-gray-600 dark:text-gray-400' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type LastSeenStatus = { dot: string; label: string; online: boolean }
function getLastSeenStatus(ts: number | null | undefined): LastSeenStatus {
  if (!ts) return { dot: 'bg-gray-400/50', label: 'Sin datos', online: false }
  const diffMin = (Date.now() - ts * 1000) / 60_000
  if (diffMin < 5)  return { dot: 'bg-emerald-500', label: 'En línea',     online: true  }
  if (diffMin < 60) return { dot: 'bg-amber-400',   label: 'Reciente',     online: false }
  return                   { dot: 'bg-red-500',     label: 'Desconectado', online: false }
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatTs(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function duration(start: number, end: number | null | undefined): string {
  if (!end) return '—'
  const secs = end - start
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

function osIcon(os: AbDevice['os_type']) {
  const icons: Record<AbDevice['os_type'], string> = { windows: '🪟', mac: '', linux: '🐧' }
  return icons[os]
}



// ─── Agent instructions modal ─────────────────────────────────────────────────

function AgentInstructionsModal({ device, onClose }: { device: AbDevice; onClose: () => void }) {
  const [downloading, setDownloading] = useState<string | null>(null)
  const [dlError, setDlError] = useState<string | null>(null)

  const handleDownload = async (platform: 'windows' | 'linux' | 'mac') => {
    setDownloading(platform)
    setDlError(null)
    try {
      await activeBackupApi.downloadAgentPackage(device.id, platform, device.name)
    } catch (e) {
      setDlError(e instanceof Error ? e.message : 'Error al descargar')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Instalar agente en {device.name}</h2>
              <p className="text-xs text-gray-500 dark:text-white/40 mt-0.5">Descarga el paquete para el sistema operativo del equipo a proteger</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 transition-colors text-xl leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-4">

          {/* Download buttons */}
          <div className="space-y-2">
            {([
              { platform: 'windows' as const, label: 'Windows', icon: '🪟', hint: 'Ejecuta instalar.cmd como Administrador' },
              { platform: 'linux'   as const, label: 'Linux',   icon: '🐧', hint: 'Ejecuta sudo bash instalar.sh' },
              { platform: 'mac'     as const, label: 'macOS',   icon: '', hint: 'Ejecuta sudo bash instalar.sh' },
            ]).map(({ platform, label, icon, hint }) => (
              <button
                key={platform}
                onClick={() => handleDownload(platform)}
                disabled={!!downloading}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors text-white"
              >
                <span className="text-xl">{icon}</span>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold">Descargar agente {label}</p>
                  <p className="text-xs text-indigo-200">{hint}</p>
                </div>
                {downloading === platform
                  ? <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  : <Download className="w-4 h-4 shrink-0" />
                }
              </button>
            ))}
          </div>

          {dlError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{dlError}</p>
          )}

          {/* How it works */}
          <div className="bg-black/5 dark:bg-white/5 rounded-xl p-4 space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-white/60 uppercase tracking-wider">Cómo funciona</p>
            <ol className="space-y-1.5 text-xs text-gray-600 dark:text-white/50">
              <li className="flex gap-2"><span className="text-indigo-500 font-bold shrink-0">1.</span>Descarga el ZIP y descomprímelo en el PC</li>
              <li className="flex gap-2"><span className="text-indigo-500 font-bold shrink-0">2.</span>Ejecuta el script de instalación como administrador</li>
              <li className="flex gap-2"><span className="text-indigo-500 font-bold shrink-0">3.</span>El agente se instala en segundo plano — el usuario no ve nada</li>
              <li className="flex gap-2"><span className="text-indigo-500 font-bold shrink-0">4.</span>Aprueba el dispositivo aquí si aparece como Pendiente</li>
            </ol>
          </div>

          {/* Note on image backup */}
          <div className="flex gap-2 bg-amber-400/5 border border-amber-400/20 rounded-lg p-3">
            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300/80">
              El ZIP descargado ya incluye la URL del NAS y el token de este dispositivo. No hace falta configurar nada manualmente.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}


// ─── Add device modal ─────────────────────────────────────────────────────────

function AddDeviceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (device: AbDevice) => void }) {
  const [name, setName] = useState('')
  const [hostname, setHostname] = useState('')
  const [osType, setOsType] = useState<'windows' | 'mac' | 'linux'>('windows')
  const createDevice = useCreateDevice()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createDevice.mutate(
      { name, hostname: hostname || null, os_type: osType },
      { onSuccess: (device) => { onCreated(device) } }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Añadir dispositivo</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 transition-colors text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-white/60">Nombre del equipo</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-white/60">Hostname (opcional)</label>
            <input
              type="text"
              value={hostname}
              onChange={e => setHostname(e.target.value)}
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700 dark:text-white/60">Sistema operativo</label>
            <div className="flex gap-2">
              {([
                { value: 'windows' as const, label: 'Windows', icon: '🪟' },
                { value: 'linux'   as const, label: 'Linux',   icon: '🐧' },
                { value: 'mac'     as const, label: 'macOS',   icon: '' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setOsType(opt.value)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                    osType === opt.value
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-gray-700 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/10',
                  )}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={createDevice.isPending || !name}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 transition-colors text-white text-sm font-semibold"
          >
            {createDevice.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Crear dispositivo
          </button>
        </form>
      </div>
    </div>
  )
}


// ─── File browser ─────────────────────────────────────────────────────────────

function FileBrowser({ deviceId, versions }: { deviceId: number; versions: VersionEntry[] }) {
  const [selectedVersion, setSelectedVersion] = useState<string>(versions[0]?.version ?? '')
  const [browsePath, setBrowsePath] = useState('/')
  const [pathHistory, setPathHistory] = useState<string[]>(['/'])
  const [downloadingFile, setDownloadingFile] = useState<Record<string, boolean>>({})

  // If the versions list changes (new backup ran, retention pruned the old one,
  // device switched) and our cached selection is no longer present, fall back
  // to the most recent version and reset the path so the browser doesn't try
  // to query a stale (versionId, path) tuple.
  useEffect(() => {
    if (versions.length === 0) {
      if (selectedVersion !== '') {
        setSelectedVersion('')
        setBrowsePath('/')
        setPathHistory(['/'])
      }
      return
    }
    const stillExists = versions.some(v => v.version === selectedVersion)
    if (!stillExists) {
      setSelectedVersion(versions[0].version)
      setBrowsePath('/')
      setPathHistory(['/'])
    }
  }, [versions, selectedVersion])

  const { data: entries, isLoading, error } = useAbBrowse(
    deviceId,
    selectedVersion || null,
    browsePath,
  )

  const navigateTo = (path: string) => {
    setPathHistory(prev => [...prev, path])
    setBrowsePath(path)
  }

  const navigateBack = () => {
    if (pathHistory.length > 1) {
      const prev = [...pathHistory]
      prev.pop()
      setPathHistory(prev)
      setBrowsePath(prev[prev.length - 1])
    }
  }

  if (versions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 dark:text-white/30 text-sm">No backup versions available yet.</div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Version selector + breadcrumb */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedVersion}
          onChange={e => { setSelectedVersion(e.target.value); setBrowsePath('/'); setPathHistory(['/']) }}
          className="bg-gray-100 dark:bg-gray-800 border border-black/10 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
        >
          {versions.map(v => (
            <option key={v.version} value={v.version}>{v.version}</option>
          ))}
        </select>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-white/40 font-mono flex-1 min-w-0">
          {pathHistory.length > 1 && (
            <button
              onClick={navigateBack}
              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 transition-colors"
            >
              ..
            </button>
          )}
          <span className="truncate">{browsePath}</span>
        </div>
      </div>

      {/* File list */}
      <div className="bg-black/20 border border-black/10 dark:border-white/10 rounded-xl overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 text-gray-400 dark:text-white/30 animate-spin" />
          </div>
        )}
        {error && (
          <div className="text-center py-6 text-red-600 dark:text-red-400/70 text-sm">Failed to load directory listing.</div>
        )}
        {entries && entries.length === 0 && (
          <div className="text-center py-6 text-gray-400 dark:text-white/30 text-sm">Empty directory.</div>
        )}
        {entries && entries.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="text-left text-xs font-medium text-gray-400 dark:text-white/30 px-4 py-2">Name</th>
                <th className="text-right text-xs font-medium text-gray-400 dark:text-white/30 px-4 py-2">Size</th>
                <th className="text-right text-xs font-medium text-gray-400 dark:text-white/30 px-4 py-2">Modified</th>
                <th className="text-right text-xs font-medium text-gray-400 dark:text-white/30 px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: AbFileEntry) => {
                const isDir = entry.type === 'directory'
                const childPath = browsePath.replace(/\/$/, '') + '/' + entry.name
                return (
                  <tr
                    key={entry.name}
                    className={cn(
                      'border-b border-black/5 dark:border-white/5 last:border-0 transition-colors',
                      isDir ? 'hover:bg-black/5 dark:bg-white/5 cursor-pointer' : 'hover:bg-white/3',
                    )}
                    onClick={isDir ? () => navigateTo(childPath) : undefined}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {isDir
                          ? <Folder className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                          : <FileText className="w-4 h-4 text-gray-400 dark:text-white/30 flex-shrink-0" />
                        }
                        <span className={cn('truncate', isDir ? 'text-white/90' : 'text-gray-600 dark:text-white/60')}>
                          {entry.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-white/40 font-mono text-xs">
                      {isDir ? '—' : formatBytes(entry.size)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-white/40 text-xs">
                      {formatTs(entry.modified)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {!isDir && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            setDownloadingFile(prev => ({ ...prev, [entry.name]: true }))
                            try {
                              await activeBackupApi.downloadRestoreFile(deviceId, selectedVersion, childPath)
                            } catch (err) {
                              console.error(err)
                            } finally {
                              setDownloadingFile(prev => ({ ...prev, [entry.name]: false }))
                            }
                          }}
                          disabled={downloadingFile[entry.name]}
                          className="p-1 rounded text-gray-400 dark:text-white/30 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-50 transition-colors"
                        >
                          {downloadingFile[entry.name]
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Download className="w-3.5 h-3.5" />
                          }
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Device detail panel ──────────────────────────────────────────────────────

function DeviceDetailPanel({ deviceId, onClose }: { deviceId: number; onClose: () => void }) {
  const { data, isLoading } = useAbDevice(deviceId)
  const { data: progress } = useAbProgress(deviceId)
  const { data: versions } = useAbVersions(deviceId)
  const triggerBackup = useTriggerBackup()
  const cancelBackup = useCancelBackup()

  const [activeTab, setActiveTab] = useState<'history' | 'files'>('history')

  const device = data?.device
  const runs = data?.runs ?? []
  const isRunning = progress?.running ?? false

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-t-2xl sm:rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-black/10 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <HardDrive className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            {device ? (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{device.name}</h2>
                <p className="text-xs text-gray-500 dark:text-white/40">{device.hostname ?? 'Unknown host'}</p>
              </div>
            ) : (
              <div className="h-6 w-40 bg-black/10 dark:bg-white/10 rounded animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {device && !isRunning && (device.status === 'approved' || device.status === 'active' || device.status === 'error') && (
              <button
                onClick={() => triggerBackup.mutate(deviceId)}
                disabled={triggerBackup.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {triggerBackup.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Play className="w-3.5 h-3.5" />
                }
                Backup Now
              </button>
            )}
            {isRunning && (
              <button
                onClick={() => cancelBackup.mutate(deviceId)}
                disabled={cancelBackup.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-400/10 hover:bg-red-400/20 disabled:opacity-50 transition-colors"
              >
                <StopCircle className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 transition-colors text-xl leading-none">&times;</button>
          </div>
        </div>

        {/* Progress bar */}
        {isRunning && progress && (
          <div className="px-5 pt-3 shrink-0">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-white/50 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-indigo-600 dark:text-indigo-400" />
                Backup in progress — Run #{progress.runId}
              </span>
              <span>{progress.progress}%</span>
            </div>
            <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1.5">
              <div
                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(3, progress.progress)}%` }}
              />
            </div>
            {progress.output.length > 0 && (
              <pre className="mt-2 bg-black/30 border border-black/5 dark:border-white/5 rounded-lg p-2 text-xs text-gray-500 dark:text-white/40 font-mono overflow-x-auto h-16 overflow-y-auto">
                {progress.output.join('\n')}
              </pre>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 px-5 pt-4 border-b border-black/5 dark:border-white/5 shrink-0">
          {(['history', 'files'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'pb-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize',
                activeTab === tab
                  ? 'text-white border-indigo-500'
                  : 'text-gray-500 dark:text-white/40 border-transparent hover:text-gray-700 dark:text-white/70',
              )}
            >
              {tab === 'history' ? 'Run History' : 'File Browser'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-gray-400 dark:text-white/30 animate-spin" />
            </div>
          )}

          {!isLoading && activeTab === 'history' && (
            <>
              {runs.length === 0 && (
                <div className="text-center py-10 text-gray-400 dark:text-white/30 text-sm">No backup runs yet.</div>
              )}
              {runs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-full">
                    <thead>
                      <tr className="border-b border-black/5 dark:border-white/5">
                        <th className="text-left text-xs font-medium text-gray-400 dark:text-white/30 pb-2 pr-4">Started</th>
                        <th className="text-left text-xs font-medium text-gray-400 dark:text-white/30 pb-2 pr-4">Version</th>
                        <th className="text-right text-xs font-medium text-gray-400 dark:text-white/30 pb-2 pr-4">Size</th>
                        <th className="text-right text-xs font-medium text-gray-400 dark:text-white/30 pb-2 pr-4">Files</th>
                        <th className="text-right text-xs font-medium text-gray-400 dark:text-white/30 pb-2 pr-4">Duration</th>
                        <th className="text-right text-xs font-medium text-gray-400 dark:text-white/30 pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {runs.map(run => {
                        const rs = RUN_STATUS[run.status]
                        return (
                          <tr key={run.id} className="hover:bg-white/3 transition-colors">
                            <td className="py-2.5 pr-4 text-gray-600 dark:text-white/60 text-xs">{formatTs(run.started_at)}</td>
                            <td className="py-2.5 pr-4">
                              <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">{run.version ?? '—'}</span>
                            </td>
                            <td className="py-2.5 pr-4 text-right text-gray-500 dark:text-white/50 text-xs font-mono">{formatBytes(run.size_bytes)}</td>
                            <td className="py-2.5 pr-4 text-right text-gray-500 dark:text-white/50 text-xs font-mono">{run.files_count ?? '—'}</td>
                            <td className="py-2.5 pr-4 text-right text-gray-500 dark:text-white/50 text-xs">{duration(run.started_at, run.finished_at)}</td>
                            <td className="py-2.5 text-right">
                              <span className={cn('text-xs font-medium', rs.color)}>{rs.label}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {!isLoading && activeTab === 'files' && (
            <FileBrowser deviceId={deviceId} versions={versions ?? []} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Device card ──────────────────────────────────────────────────────────────

function DeviceCard({
  device,
  onViewDetail,
  onShowInstructions,
}: {
  device: AbDevice
  onViewDetail: (id: number) => void
  onShowInstructions: (device: AbDevice) => void
}) {
  const approve = useApproveDevice()
  const del = useDeleteDevice()
  const trigger = useTriggerBackup()
  const { data: progress } = useAbProgress(device.id)
  const isRunning = progress?.running ?? false

  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className={cn(
      'bg-gray-900/60 border rounded-xl p-4 space-y-3 transition-all',
      device.status === 'active' ? 'border-emerald-500/20' : 'border-black/10 dark:border-white/10',
    )}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex-shrink-0">
            <span className="text-lg leading-none" title={device.os_type}>{osIcon(device.os_type)}</span>
            {(() => {
              const lss = getLastSeenStatus(device.last_seen)
              return (
                <span
                  className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-900', lss.dot, lss.online && 'animate-pulse')}
                  title={`${lss.label}${device.last_seen ? ` — ${formatTs(device.last_seen)}` : ''}`}
                />
              )
            })()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">{device.name}</p>
            <p className="text-xs text-gray-500 dark:text-white/40 truncate">{device.hostname ?? 'No hostname'}</p>
          </div>
        </div>
        <StatusBadge status={device.status} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-400 dark:text-white/30">Último backup</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-gray-700 dark:text-white/70">{device.last_run_at ? formatTs(device.last_run_at) : '—'}</p>
            {device.last_run_status === 'success' && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">✓ OK</span>}
            {device.last_run_status === 'error'   && <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">✗ Error</span>}
          </div>
        </div>
        <div>
          <p className="text-gray-400 dark:text-white/30">Última conexión</p>
          <p className="text-gray-700 dark:text-white/70 mt-0.5">{device.last_seen ? formatTs(device.last_seen) : '—'}</p>
        </div>
        <div>
          <p className="text-gray-400 dark:text-white/30">Retención</p>
          <p className="text-gray-700 dark:text-white/70 mt-0.5">{device.retention_days}d</p>
        </div>
        <div>
          <p className="text-gray-400 dark:text-white/30">Programación</p>
          <p className="text-gray-700 dark:text-white/70 font-mono text-[10px] mt-0.5">{device.schedule_cron ?? 'Manual'}</p>
        </div>
      </div>

      {/* Running progress */}
      {isRunning && progress && (
        <div>
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-white/40 mb-1">
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin text-indigo-600 dark:text-indigo-400" />
              Backing up…
            </span>
            <span>{progress.progress}%</span>
          </div>
          <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1">
            <div className="bg-indigo-500 h-1 rounded-full transition-all duration-500" style={{ width: `${Math.max(3, progress.progress)}%` }} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1 flex-wrap">
        {device.status === 'pending' && (
          <button
            onClick={() => approve.mutate(device.id)}
            disabled={approve.isPending}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {approve.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Approve
          </button>
        )}

        {!isRunning && (device.status === 'approved' || device.status === 'active' || device.status === 'error') && (
          <button
            onClick={() => trigger.mutate(device.id)}
            disabled={trigger.isPending}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-900 dark:text-white bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:bg-white/15 disabled:opacity-50 transition-colors"
          >
            {trigger.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Backup
          </button>
        )}

        <button
          onClick={() => onViewDetail(device.id)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600 dark:text-white/60 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 transition-colors"
        >
          <FolderOpen className="w-3 h-3" />
          Detail
        </button>

        <button
          onClick={() => onShowInstructions(device)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600 dark:text-white/60 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 transition-colors"
          title="How to connect agent"
        >
          <Info className="w-3 h-3" />
        </button>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400/70 hover:text-red-600 dark:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        ) : (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => del.mutate(device.id)}
              disabled={del.isPending}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-400/10 hover:bg-red-400/20 disabled:opacity-50 transition-colors"
            >
              {del.isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Delete'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-gray-900/60 border border-black/10 dark:border-white/10 rounded-xl p-4 space-y-3 animate-pulse">
      <div className="flex justify-between">
        <div className="flex gap-2">
          <div className="w-7 h-7 rounded-md bg-black/10 dark:bg-white/10" />
          <div className="space-y-1.5">
            <div className="h-4 w-32 bg-black/10 dark:bg-white/10 rounded" />
            <div className="h-3 w-20 bg-black/5 dark:bg-white/5 rounded" />
          </div>
        </div>
        <div className="h-5 w-16 bg-black/10 dark:bg-white/10 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-black/5 dark:bg-white/5 rounded" />)}
      </div>
      <div className="h-8 bg-black/5 dark:bg-white/5 rounded-lg" />
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ActiveBackupView() {
  const t = useT()
  const { data: devices, isLoading, error, refetch } = useAbDevices()

  const [detailDeviceId, setDetailDeviceId] = useState<number | null>(null)
  const [instructionsDevice, setInstructionsDevice] = useState<AbDevice | null>(null)
  const [showAddDevice, setShowAddDevice] = useState(false)

  const pendingCount = devices?.filter(d => d.status === 'pending').length ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.activeBackup.title}</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.activeBackup.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-600 dark:text-amber-400 text-xs font-medium">
              <AlertCircle className="w-3.5 h-3.5" />
              {pendingCount} pending approval
            </span>
          )}
          <button
            onClick={() => setShowAddDevice(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Añadir dispositivo
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-white/60 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {devices && devices.length > 0 && (() => {
        const online   = devices.filter(d => getLastSeenStatus(d.last_seen).online).length
        const pending  = devices.filter(d => d.status === 'pending').length
        const lastRuns = devices.map(d => d.last_run_at).filter((t): t is number => !!t).sort((a, b) => b - a)
        // TODO: read this from the backend's configured TZ instead of hardcoding.
        // Backend currently runs in Europe/Madrid; without an explicit timeZone
        // the browser's local TZ wins, which produces wrong-looking timestamps
        // when the user is travelling or the NAS is in a different region.
        const lastBackupStr = lastRuns.length
          ? new Date(lastRuns[0] * 1000).toLocaleString(undefined, {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Madrid',
            })
          : '—'
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Dispositivos',   value: devices.length,   color: 'text-gray-900 dark:text-white' },
              { label: 'En línea',       value: online,           color: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'Pendientes',     value: pending,          color: pending > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white' },
              { label: 'Último backup',  value: lastBackupStr,    color: 'text-gray-600 dark:text-white/60' },
            ].map(s => (
              <div key={s.label} className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl px-4 py-3">
                <p className={cn('text-lg font-bold tabular-nums', s.color)}>{s.value}</p>
                <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )
      })()}

{/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <XCircle className="w-8 h-8 text-red-600 dark:text-red-400/60 mx-auto mb-2" />
          <p className="text-red-600 dark:text-red-400 text-sm">{t.common.error}</p>
          <button onClick={() => refetch()} className="mt-3 text-xs text-red-600 dark:text-red-400/70 hover:text-red-600 dark:text-red-400 underline underline-offset-2 transition-colors">
            {t.common.refresh}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && devices?.length === 0 && (
        <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-12 text-center">
          <HardDrive className="w-10 h-10 text-gray-400 dark:text-white/20 mx-auto mb-3" />
          <p className="text-gray-900 dark:text-white font-medium">{t.activeBackup.noDevices}</p>
          <p className="text-gray-500 dark:text-white/40 text-sm mt-1">Añade un dispositivo para descargar el agente e instalarlo en el equipo a proteger.</p>
          <button
            onClick={() => setShowAddDevice(true)}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Añadir dispositivo
          </button>
        </div>
      )}

      {/* Device grid */}
      {devices && devices.length > 0 && (
        <>
          {/* Pending section */}
          {devices.some(d => d.status === 'pending') && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-semibold text-gray-700 dark:text-white/70 uppercase tracking-wider">Pending Approval</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {devices
                  .filter(d => d.status === 'pending')
                  .map(d => (
                    <DeviceCard
                      key={d.id}
                      device={d}
                      onViewDetail={setDetailDeviceId}
                      onShowInstructions={setInstructionsDevice}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Active/approved devices */}
          {devices.some(d => d.status !== 'pending') && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h2 className="text-sm font-semibold text-gray-700 dark:text-white/70 uppercase tracking-wider">Managed Devices</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {devices
                  .filter(d => d.status !== 'pending')
                  .map(d => (
                    <DeviceCard
                      key={d.id}
                      device={d}
                      onViewDetail={setDetailDeviceId}
                      onShowInstructions={setInstructionsDevice}
                    />
                  ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {detailDeviceId !== null && (
        <DeviceDetailPanel
          deviceId={detailDeviceId}
          onClose={() => setDetailDeviceId(null)}
        />
      )}
      {instructionsDevice && (
        <AgentInstructionsModal
          device={instructionsDevice}
          onClose={() => setInstructionsDevice(null)}
        />
      )}
      {showAddDevice && (
        <AddDeviceModal
          onClose={() => setShowAddDevice(false)}
          onCreated={(device) => {
            setShowAddDevice(false)
            setInstructionsDevice(device)
          }}
        />
      )}

    </div>
  )
}
