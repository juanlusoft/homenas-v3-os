import { useMemo, useState } from 'react'
import {
  Play, Square, RotateCcw, Trash2, FileText,
  Pause, PlayCircle, ChevronDown, ChevronRight, Pencil, ExternalLink,
} from 'lucide-react'
import { useContainers, useContainerAction } from '../../hooks/useDocker'
import { useHomeCatalog } from '../../hooks/useHomeStore'
import { LogsModal } from './LogsModal'
import type { CatalogApp, Container } from '@homenas/shared'
import { useT } from '../../i18n/useT'
import { ContainerEditModal } from '../../components/container-form'

// ─── Container icon ───────────────────────────────────────────────────────────

const ICON_ALIASES: Record<string, string> = {
  // *arr stack
  'plex-media-server': 'plex', 'plex': 'plex',
  'sonarr': 'sonarr', 'radarr': 'radarr', 'prowlarr': 'prowlarr',
  'bazarr': 'bazarr', 'lidarr': 'lidarr', 'readarr': 'readarr',
  'overseerr': 'overseerr', 'jellyseerr': 'jellyseerr', 'seerr': 'jellyseerr',
  // Media
  'jellyfin': 'jellyfin', 'emby': 'emby',
  'tautulli': 'tautulli', 'navidrome': 'navidrome',
  // Download
  'qbittorrent': 'qbittorrent', 'transmission': 'transmission',
  'nicotine-plus': 'nicotine-plus',
  // Networking / proxy
  'nginx': 'nginx', 'traefik': 'traefik',
  'nginx-proxy-manager': 'nginx-proxy-manager', 'swag': 'nginx',
  'wireguard': 'wireguard', 'tailscale': 'tailscale',
  'cloudflared': 'cloudflare', 'cloudflare-tunnel': 'cloudflare',
  'adguard': 'adguard-home', 'adguardhome': 'adguard-home', 'adguard-home': 'adguard-home',
  'pihole': 'pi-hole', 'pi-hole': 'pi-hole',
  'uptime-kuma': 'uptime-kuma',
  // Cloud / storage
  'nextcloud': 'nextcloud', 'immich': 'immich', 'photoprism': 'photoprism',
  'filebrowser': 'filebrowser', 'duplicati': 'duplicati', 'icloudpd': 'icloud',
  // Home automation
  'homeassistant': 'home-assistant', 'home-assistant': 'home-assistant',
  'frigate': 'frigate',
  // Infra / monitoring
  'portainer': 'portainer', 'grafana': 'grafana', 'influxdb': 'influxdb',
  'dozzle': 'dozzle', 'beszel': 'beszel', 'speedtest-tracker': 'speedtest-tracker',
  // Security
  'vaultwarden': 'vaultwarden', 'bitwarden': 'vaultwarden',
  // Productivity / docs
  'gitea': 'gitea', 'onlyoffice': 'onlyoffice', 'stirling-pdf': 'stirling-pdf',
  'excalidraw': 'excalidraw', 'flatnotes': 'flatnotes', 'paperless': 'paperless',
  'heimdall': 'heimdall',
  // Books / media management
  'kavita': 'kavita', 'komga': 'komga', 'ubooquity': 'ubooquity',
  'booklore': 'booklore', 'karakeep': 'karakeep',
  // Dev / misc
  'code-server': 'code-server', 'caddy': 'caddy', 'guacamole': 'guacamole',
  'rsync-server': 'rsync', 'rsync': 'rsync',
  'traccar': 'traccar', 'pulsarr': 'pulsarr', 'tvheadend': 'tvheadend',
}

function resolveIconKey(name: string): string {
  const lower = name.toLowerCase()
  const stripped = lower
    .replace(/^(homestore|docker|stack|my|custom)-/, '')
    .replace(/-server$/, '')
    .replace(/_/g, '-')
  return ICON_ALIASES[lower] ?? ICON_ALIASES[stripped] ?? stripped
}

const FALLBACK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="20" font-size="18">🐳</text></svg>')}`

function ContainerIcon({ name }: { name: string }) {
  const [src, setSrc] = useState(
    `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${resolveIconKey(name)}.png`,
  )
  return (
    <img
      src={src}
      alt=""
      className="w-8 h-8 rounded object-contain flex-shrink-0"
      onError={() => setSrc(FALLBACK)}
    />
  )
}

// ─── Sensitive key patterns ───────────────────────────────────────────────────

const SENSITIVE_PATTERN = /PASSWORD|SECRET|TOKEN|KEY/i

function maskEnvVar(entry: string): string {
  const eqIdx = entry.indexOf('=')
  if (eqIdx === -1) return entry
  const key = entry.slice(0, eqIdx)
  const value = entry.slice(eqIdx + 1)
  if (SENSITIVE_PATTERN.test(key)) {
    return `${key}=***`
  }
  return `${key}=${value}`
}

// ─── EnvVarsSection ───────────────────────────────────────────────────────────

function EnvVarsSection({ envVars }: { envVars: string[] }) {
  const [open, setOpen] = useState(false)
  if (!envVars.length) return null

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>Env vars ({envVars.length})</span>
      </button>
      {open && (
        <div className="mt-1.5 pl-1 max-h-40 overflow-y-auto space-y-0.5">
          {envVars.map((entry, i) => {
            const masked = maskEnvVar(entry)
            const isMasked = masked !== entry
            return (
              <div key={i} className="font-mono text-xs leading-relaxed">
                <span className={isMasked ? 'text-yellow-600 dark:text-yellow-400/60' : 'text-gray-500 dark:text-white/50'}>
                  {masked}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase()
  if (lower === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-green-500/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        running
      </span>
    )
  }
  if (lower === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
        paused
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      {lower || 'exited'}
    </span>
  )
}

function getWebPort(ports: Container['ports']): number | null {
  const tcp = ports.filter(p => p.protocol === 'tcp' && p.hostPort !== null)
  if (tcp.length === 0) return null
  // Prefer common web ports, then lowest host port
  const preferred = [80, 443, 8080, 8443, 8096, 8123, 3000, 9000, 7878, 8989, 8686, 9696]
  for (const p of preferred) {
    if (tcp.some(t => t.containerPort === p || t.hostPort === p)) {
      const match = tcp.find(t => t.containerPort === p || t.hostPort === p)
      return match?.hostPort ?? null
    }
  }
  return tcp.sort((a, b) => (a.hostPort ?? 0) - (b.hostPort ?? 0))[0]?.hostPort ?? null
}

function formatPorts(ports: Container['ports']): string {
  if (!ports.length) return '—'
  return ports
    .map((p) => p.hostPort != null ? `${p.hostPort}→${p.containerPort}/${p.protocol}` : `${p.containerPort}/${p.protocol}`)
    .join(', ')
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

interface ContainerRowProps {
  container: Container
  /**
   * If the container belongs to a HomeStore app, this is the matching
   * CatalogApp. The "Edit" button is rendered only when this is non-null —
   * the PATCH /api/containers/:id endpoint only knows how to edit apps with a
   * persisted config under the homestore service.
   */
  homeStoreApp: CatalogApp | null
  onAction: (containerId: string, action: string) => void
  onViewLogs: (container: Container) => void
  onEdit: (app: CatalogApp) => void
  pending: boolean
}

function ContainerRow({
  container,
  homeStoreApp,
  onAction,
  onViewLogs,
  onEdit,
  pending,
}: ContainerRowProps) {
  const t = useT()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const isRunning = container.status === 'running'
  const isPaused = container.status === 'paused'

  return (
    <>
      <tr className="border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:bg-white/5 transition-colors">
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <ContainerIcon name={container.name} />
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-white text-sm truncate" title={container.name}>
                {container.name}
              </div>
              <div className="text-gray-500 dark:text-white/40 text-xs font-mono truncate" title={container.image}>
                {container.image}
              </div>
              <EnvVarsSection envVars={container.envVars ?? []} />
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={container.status} />
        </td>
        <td className="px-4 py-3 text-xs text-gray-500 dark:text-white/50 font-mono truncate hidden sm:table-cell" title={formatPorts(container.ports)}>
          {formatPorts(container.ports)}
        </td>
        <td className="px-4 py-3 text-xs text-gray-600 dark:text-white/60 tabular-nums font-mono">
          {container.cpuPercent !== null ? `${container.cpuPercent.toFixed(1)}%` : '—'}
        </td>
        <td className="px-4 py-3 text-xs text-gray-600 dark:text-white/60 tabular-nums font-mono">
          {container.memUsageBytes !== null ? formatBytes(container.memUsageBytes) : '—'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            {/* Start */}
            {!isRunning && !isPaused && (
              <button
                title={t.common.start}
                disabled={pending}
                onClick={() => onAction(container.id, 'start')}
                className="p-1.5 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-700 dark:text-green-400 disabled:opacity-40 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Stop */}
            {isRunning && (
              <button
                title={t.common.stop}
                disabled={pending}
                onClick={() => onAction(container.id, 'stop')}
                className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-400 disabled:opacity-40 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Pause / Unpause */}
            {isRunning && (
              <button
                title="Pause"
                disabled={pending}
                onClick={() => onAction(container.id, 'pause')}
                className="p-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-600 dark:text-yellow-400 disabled:opacity-40 transition-colors"
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
            {isPaused && (
              <button
                title="Unpause"
                disabled={pending}
                onClick={() => onAction(container.id, 'unpause')}
                className="p-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-600 dark:text-yellow-400 disabled:opacity-40 transition-colors"
              >
                <PlayCircle className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Restart */}
            {(isRunning || isPaused) && (
              <button
                title={t.common.restart}
                disabled={pending}
                onClick={() => onAction(container.id, 'restart')}
                className="p-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-600 dark:text-indigo-400 disabled:opacity-40 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Open web UI */}
            {isRunning && (() => {
              const webPort = getWebPort(container.ports)
              if (!webPort) return null
              const protocol = webPort === 443 ? 'https' : 'http'
              return (
                <a
                  href={`${protocol}://${window.location.hostname}:${webPort}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir interfaz web"
                  className="p-1.5 rounded-lg bg-black/10 dark:bg-white/10 hover:bg-indigo-500/20 text-gray-600 dark:text-white/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )
            })()}
            {/* Logs */}
            <button
              title={t.common.logs}
              onClick={() => onViewLogs(container)}
              className="p-1.5 rounded-lg bg-black/10 dark:bg-white/10 hover:bg-white/20 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            {/* Edit (only for HomeStore-installed apps) */}
            {homeStoreApp && (
              <button
                title={t.common.edit}
                disabled={pending}
                onClick={() => onEdit(homeStoreApp)}
                className="p-1.5 rounded-lg bg-black/10 dark:bg-white/10 hover:bg-indigo-500/20 text-gray-600 dark:text-white/60 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-40 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Remove */}
            <button
              title="Remove"
              disabled={pending}
              onClick={() => setConfirmRemove(true)}
              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400/60 hover:text-red-600 dark:text-red-400 disabled:opacity-40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>

      {/* Confirm remove dialog */}
      {confirmRemove && (
        <tr>
          <td colSpan={6} className="px-0 py-0">
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 space-y-4">
                <h3 className="text-gray-900 dark:text-white font-semibold">{t.docker.removeContainer}</h3>
                <p className="text-gray-600 dark:text-white/60 text-sm">
                  Remove <span className="font-mono text-gray-900 dark:text-white">{container.name}</span>? This will force-remove the container and cannot be undone.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setConfirmRemove(false)}
                    className="text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-black/10 dark:bg-white/10 transition-colors"
                  >
                    {t.common.cancel}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmRemove(false)
                      onAction(container.id, 'remove')
                    }}
                    className="text-sm font-medium bg-red-500/20 hover:bg-red-500/30 text-red-700 dark:text-red-300 px-4 py-2 rounded-lg transition-colors"
                  >
                    {t.common.remove}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function ContainersCard() {
  const t = useT()
  const { data: containers, isLoading } = useContainers()
  const { data: catalog } = useHomeCatalog()
  const actionMutation = useContainerAction()
  const [logsContainer, setLogsContainer] = useState<Container | null>(null)
  const [editingApp, setEditingApp] = useState<CatalogApp | null>(null)

  // Map docker container *name* → CatalogApp so the "Edit" button only shows
  // for HomeStore-managed containers. We key on `containerName` because the
  // HomeStore service uses a deterministic name per app and that's what the
  // backend matches to perform the edit; container *id* would also work but
  // can change after recreation.
  const homeStoreByName = useMemo(() => {
    const map = new Map<string, CatalogApp>()
    if (!catalog) return map
    for (const app of catalog) {
      if (app.containerName) {
        map.set(app.containerName, app)
      }
    }
    return map
  }, [catalog])

  function handleAction(containerId: string, action: string) {
    actionMutation.mutate({
      containerId,
      action: action as ContainerAction['action'],
    })
  }

  type ContainerAction = import('@homenas/shared').ContainerAction

  return (
    <div className="bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h2 className="font-semibold text-gray-900 dark:text-white">{t.docker.containers}</h2>
        </div>
        {containers && (
          <span className="text-xs text-gray-500 dark:text-white/40">
            {containers.filter((c) => c.status === 'running').length}/{containers.length} running
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider">{t.docker.name}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider">{t.docker.status}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider hidden sm:table-cell">{t.docker.ports}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider">CPU</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider">{t.docker.memory}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-black/10 dark:bg-white/10 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            )}
            {!isLoading && containers?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-white/30 text-sm">
                  No containers found
                </td>
              </tr>
            )}
            {containers?.map((container) => (
              <ContainerRow
                key={container.id}
                container={container}
                homeStoreApp={homeStoreByName.get(container.name) ?? null}
                onAction={handleAction}
                onViewLogs={setLogsContainer}
                onEdit={setEditingApp}
                pending={actionMutation.isPending}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Logs Modal */}
      {logsContainer && (
        <LogsModal
          containerId={logsContainer.id}
          containerName={logsContainer.name}
          onClose={() => setLogsContainer(null)}
        />
      )}

      {/* Edit Modal (HomeStore apps only) */}
      {editingApp && (
        <ContainerEditModal
          container={editingApp}
          isOpen
          onClose={() => setEditingApp(null)}
          onSaved={() => setEditingApp(null)}
        />
      )}
    </div>
  )
}
