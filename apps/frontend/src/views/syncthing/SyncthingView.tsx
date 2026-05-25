import { useState } from 'react'
import {
  RefreshCw,
  Monitor,
  Folder,
  Plus,
  Trash2,
  Play,
  Square,
  Download,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronRight,
} from 'lucide-react'
import {
  useSyncthingStatus,
  useSyncthingDevices,
  useSyncthingFolders,
  useSyncStatus,
  useInstallSyncthing,
  useStartSyncthing,
  useStopSyncthing,
  useAddDevice,
  useRemoveDevice,
  useAddFolder,
  useRemoveFolder,
} from '../../hooks/useSyncthing'
import type { SyncthingDevice, SyncthingFolder } from '../../api/syncthing'
import { useT } from '../../i18n/useT'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateId(id: string, chars = 20): string {
  return id.length > chars ? id.slice(0, chars) + '…' : id
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  const t = useT()
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        active
          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
          : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/40'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-white/30'}`} />
      {active ? t.docker.running : t.docker.stopped}
    </span>
  )
}

function SyncBar({ percent }: { percent: number }) {
  const p = Math.min(100, Math.max(0, percent))
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            p === 100 ? 'bg-emerald-500' : 'bg-indigo-500'
          }`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 dark:text-white/50 w-8 text-right">{p}%</span>
    </div>
  )
}

// ─── Add Device Modal ─────────────────────────────────────────────────────────

function AddDeviceModal({ onClose }: { onClose: () => void }) {
  const [deviceId, setDeviceId] = useState('')
  const [name, setName] = useState('')
  const addDevice = useAddDevice()
  const t = useT()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await addDevice.mutateAsync({ deviceId: deviceId.trim(), name: name.trim() })
      onClose()
    } catch {
      // error shown below
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-5">{t.syncthing.addDevice}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">{t.syncthing.deviceId}</label>
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">{t.common.name}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My laptop"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
          {addDevice.error && (
            <p className="text-xs text-red-600 dark:text-red-400">{String(addDevice.error)}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={addDevice.isPending}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {addDevice.isPending ? t.common.saving : t.syncthing.addDevice}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Add Folder Modal ─────────────────────────────────────────────────────────

function AddFolderModal({
  devices,
  onClose,
}: {
  devices: SyncthingDevice[]
  onClose: () => void
}) {
  const [id, setId] = useState('')
  const [path, setPath] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const addFolder = useAddFolder()
  const t = useT()

  const toggleDevice = (deviceId: string) => {
    setSelected((prev) =>
      prev.includes(deviceId) ? prev.filter((d) => d !== deviceId) : [...prev, deviceId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await addFolder.mutateAsync({ id: id.trim(), path: path.trim(), sharedWithDevices: selected })
      onClose()
    } catch {
      // error shown below
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-5">{t.syncthing.addFolder}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">{t.syncthing.folderId}</label>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-docs"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">{t.syncthing.path}</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/data/sync/my-docs"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
          {devices.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">{t.syncthing.shareWith}</label>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {devices.map((d) => (
                  <label
                    key={d.deviceID}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-black/5 dark:bg-white/5 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(d.deviceID)}
                      onChange={() => toggleDevice(d.deviceID)}
                      className="accent-indigo-500"
                    />
                    <span className="text-sm text-gray-900 dark:text-white">{d.name}</span>
                    <span className="text-xs text-gray-400 dark:text-white/30 ml-auto font-mono">{truncateId(d.deviceID, 16)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {addFolder.error && (
            <p className="text-xs text-red-600 dark:text-red-400">{String(addFolder.error)}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={addFolder.isPending}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {addFolder.isPending ? t.common.saving : t.syncthing.addFolder}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Devices Tab ──────────────────────────────────────────────────────────────

function DevicesTab() {
  const { data: devices, isLoading, error } = useSyncthingDevices()
  const { data: folders } = useSyncthingFolders()
  const { data: syncStatus } = useSyncStatus()
  const removeDevice = useRemoveDevice()
  const [showAdd, setShowAdd] = useState(false)
  const t = useT()

  // Sync % per device. We don't have per-(device,folder) data from the
  // backend, so we approximate by taking the minimum completion across the
  // folders that are actually shared with this device. Previously this used
  // a single global Math.min, which made every device show the same %.
  // TODO: expose Syncthing's /rest/db/completion per device+folder in the
  // backend for an exact value.
  const getSyncPercent = (deviceId: string): number | null => {
    if (!syncStatus || syncStatus.length === 0) return null
    if (!folders || folders.length === 0) return null

    const folderIdsForDevice = new Set(
      folders
        .filter((f) => f.devices.some((d) => d.deviceID === deviceId))
        .map((f) => f.id)
    )
    if (folderIdsForDevice.size === 0) return null

    const relevant = syncStatus.filter((s) => folderIdsForDevice.has(s.folderId))
    if (relevant.length === 0) return null

    return Math.min(...relevant.map((s) => s.completion))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-white/40">
          {devices ? t.syncthing.deviceCount(devices.length) : ''}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.syncthing.addDevice}
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
          {t.syncthing.failedToLoad}
        </div>
      )}

      {devices && devices.length === 0 && (
        <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-8 text-center">
          <Monitor className="w-8 h-8 text-gray-400 dark:text-white/20 mx-auto mb-2" />
          <p className="text-sm text-gray-400 dark:text-white/30">{t.syncthing.noDevices}</p>
        </div>
      )}

      {devices && devices.length > 0 && (
        <div className="space-y-2">
          {devices.map((device: SyncthingDevice) => {
            const percent = getSyncPercent(device.deviceID)
            return (
              <div
                key={device.deviceID}
                className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4 flex items-center gap-4"
              >
                <Monitor className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{device.name}</span>
                    {device.paused && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">{t.syncthing.paused}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-white/30 font-mono">{truncateId(device.deviceID, 32)}</span>
                  {percent !== null && percent < 100 && (
                    <div className="mt-2">
                      <SyncBar percent={percent} />
                    </div>
                  )}
                  {percent === 100 && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1">
                      <CheckCircle className="w-3 h-3" /> {t.syncthing.synced}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => removeDevice.mutate(device.deviceID)}
                  disabled={removeDevice.isPending}
                  className="p-1.5 rounded-lg text-gray-400 dark:text-white/30 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                  title={t.syncthing.removeDevice}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddDeviceModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ─── Folders Tab ─────────────────────────────────────────────────────────────

function FoldersTab() {
  const { data: folders, isLoading, error } = useSyncthingFolders()
  const { data: devices } = useSyncthingDevices()
  const { data: syncStatus } = useSyncStatus()
  const removeFolder = useRemoveFolder()
  const [showAdd, setShowAdd] = useState(false)
  const t = useT()

  const getFolderSync = (folderId: string) =>
    syncStatus?.find((s) => s.folderId === folderId) ?? null

  const getDeviceName = (deviceId: string): string => {
    if (!devices) return truncateId(deviceId, 16)
    const d = devices.find((dev) => dev.deviceID === deviceId)
    return d ? d.name : truncateId(deviceId, 16)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-white/40">
          {folders ? t.syncthing.folderCount(folders.length) : ''}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.syncthing.addFolder}
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
          {t.syncthing.failedToLoad}
        </div>
      )}

      {folders && folders.length === 0 && (
        <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-8 text-center">
          <Folder className="w-8 h-8 text-gray-400 dark:text-white/20 mx-auto mb-2" />
          <p className="text-sm text-gray-400 dark:text-white/30">{t.syncthing.noFolders}</p>
        </div>
      )}

      {folders && folders.length > 0 && (
        <div className="space-y-2">
          {folders.map((folder: SyncthingFolder) => {
            const sync = getFolderSync(folder.id)
            return (
              <div
                key={folder.id}
                className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4"
              >
                <div className="flex items-start gap-3">
                  <Folder className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{folder.label || folder.id}</span>
                      <button
                        onClick={() => removeFolder.mutate(folder.id)}
                        disabled={removeFolder.isPending}
                        className="p-1.5 rounded-lg text-gray-400 dark:text-white/30 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                        title={t.syncthing.removeFolder}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-white/30 font-mono mt-0.5 truncate">{folder.path}</p>

                    {/* Shared devices */}
                    {folder.devices.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {folder.devices.map((d) => (
                          <span
                            key={d.deviceID}
                            className="text-xs px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/50"
                          >
                            {getDeviceName(d.deviceID)}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Sync progress */}
                    {sync && (
                      <div className="mt-2 space-y-1">
                        <SyncBar percent={sync.completion} />
                        {sync.needBytes > 0 && (
                          <p className="text-xs text-gray-400 dark:text-white/30">
                            {formatBytes(sync.needBytes)} remaining of {formatBytes(sync.globalBytes)}
                          </p>
                        )}
                      </div>
                    )}

                    {folder.paused && (
                      <span className="inline-flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                        <AlertCircle className="w-3 h-3" /> {t.syncthing.paused}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <AddFolderModal
          devices={devices ?? []}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────

type Tab = 'devices' | 'folders'

export function SyncthingView() {
  const [tab, setTab] = useState<Tab>('devices')
  const { data: status, isLoading: statusLoading } = useSyncthingStatus()
  const install = useInstallSyncthing()
  const start = useStartSyncthing()
  const stop = useStopSyncthing()
  const t = useT()

  const installed = status?.installed ?? false
  const active = status?.active ?? false

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.syncthing.title}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.syncthing.subtitle}</p>
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
                <RefreshCw className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{t.syncthing.title}</span>
                  {installed && <StatusBadge active={active} />}
                  {!installed && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/40">{t.syncthing.notInstalled}</span>
                  )}
                </div>
                {installed && status?.version && (
                  <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">{t.syncthing.version} {status.version}</p>
                )}
                {active && status?.deviceId && (
                  <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5 font-mono">
                    {t.syncthing.myId}: {truncateId(status.deviceId, 32)}
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {!installed && (
                <button
                  onClick={() => install.mutate()}
                  disabled={install.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  {install.isPending ? t.common.applying : t.common.install}
                </button>
              )}
              {installed && !active && (
                <button
                  onClick={() => start.mutate()}
                  disabled={start.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  {start.isPending ? t.common.applying : t.common.start}
                </button>
              )}
              {installed && active && (
                <button
                  onClick={() => stop.mutate()}
                  disabled={stop.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-black/10 dark:bg-white/10 hover:bg-white/20 disabled:opacity-50 transition-colors"
                >
                  <Square className="w-4 h-4" />
                  {stop.isPending ? t.common.applying : t.common.stop}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error feedback */}
        {install.error && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            <XCircle className="w-3.5 h-3.5" />
            {String(install.error)}
          </div>
        )}
      </div>

      {/* Tabs — only show if installed */}
      {installed && (
        <>
          <div className="flex gap-1 bg-black/5 dark:bg-white/5 rounded-xl p-1 w-fit">
            {(['devices', 'folders'] as Tab[]).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                  tab === tabKey
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70'
                }`}
              >
                {tabKey === 'devices' ? (
                  <span className="flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5" />
                    {t.syncthing.devices}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5" />
                    {t.syncthing.folders}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === 'devices' && <DevicesTab />}
          {tab === 'folders' && <FoldersTab />}
        </>
      )}

      {/* Not active notice */}
      {installed && !active && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {t.syncthing.notRunning}
          </p>
          <ChevronRight className="w-4 h-4 text-yellow-600 dark:text-yellow-400/50 ml-auto shrink-0" />
        </div>
      )}
    </div>
  )
}
