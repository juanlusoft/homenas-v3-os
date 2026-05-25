import {
  Server,
  Battery,
  Bell,
  CheckCircle,
  AlertTriangle,
  Info,
  XCircle,
  Check,
} from 'lucide-react'
import { useSystemInfo, useUpsStatus, useNotifications, useMarkNotificationAsRead } from '../../hooks/useSystemInfo'
import type { SystemInfo, UpsStatus, Notification } from '@homenas/shared'
import { UpdatesCard } from './UpdatesCard'
import { NotificationsConfigCard } from './NotificationsConfigCard'
import { SshToggleCard } from './SshToggleCard'
import { DatabaseCard } from './DatabaseCard'
import { AuditLogCard } from './AuditLogCard'
import { useT } from '../../i18n/useT'

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 p-5 ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4 text-gray-600 dark:text-gray-300">
      {icon}
      <span className="text-sm font-semibold uppercase tracking-wider">{title}</span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-black/5 dark:border-white/5 last:border-0">
      <span className="text-xs text-gray-500 dark:text-white/40 uppercase tracking-wider">{label}</span>
      <span className="font-mono text-sm text-gray-200 text-right">{value}</span>
    </div>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-black/10 dark:bg-white/10 rounded ${className}`} />
}

// ─── SystemInfoCard ───────────────────────────────────────────────────────────

function SystemInfoCard({ data }: { data: SystemInfo }) {
  const t = useT()

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const parts = []
    if (d > 0) parts.push(`${d}d`)
    if (h > 0) parts.push(`${h}h`)
    parts.push(`${m}m`)
    return parts.join(' ')
  }

  return (
    <Card>
      <CardHeader icon={<Server className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />} title={t.system.systemInfo} />
      <div className="space-y-0">
        <Row label={t.system.hostname} value={data.hostname} />
        <Row label={t.system.os} value={data.os} />
        <Row label={t.system.kernel} value={data.kernel} />
        <Row label={t.system.architecture} value={data.arch} />
        <Row label={t.system.nodejs} value={data.nodeVersion} />
        <Row label={t.system.appVersion} value={`v${data.appVersion}`} />
        <Row label={t.system.uptime} value={formatUptime(data.uptime)} />
        <Row label={t.system.timezone} value={data.timezone} />
        <Row
          label={t.system.ipAddresses}
          value={
            data.ipAddresses.length > 0
              ? data.ipAddresses.join(', ')
              : <span className="text-gray-400 dark:text-white/30 italic">none</span>
          }
        />
      </div>
    </Card>
  )
}

// ─── UPS Card ─────────────────────────────────────────────────────────────────

function CircularGauge({ percent }: { percent: number }) {
  const r = 32
  const circumference = 2 * Math.PI * r
  const filled = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)
  const color =
    percent > 50 ? '#22c55e' : percent > 20 ? '#f59e0b' : '#ef4444'

  return (
    <svg className="w-20 h-20" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeDasharray={circumference}
        strokeDashoffset={filled}
        strokeLinecap="round"
        transform="rotate(-90 40 40)"
        className="transition-all duration-500"
      />
      <text x="40" y="44" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">
        {percent.toFixed(0)}%
      </text>
    </svg>
  )
}

function UpsCard({ data }: { data: UpsStatus }) {
  const t = useT()

  const statusLabel: Record<string, string> = {
    OL: t.common.online,
    OB: t.system.onBattery,
    LB: t.system.lowBattery,
    RB: t.system.replaceBattery,
  }

  const formatRuntime = (seconds: number | null) => {
    if (seconds === null) return 'N/A'
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m ${s}s`
  }

  if (!data.connected) {
    return (
      <Card>
        <CardHeader icon={<Battery className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />} title={t.system.upsStatus} />
        <div className="flex items-center gap-2 text-gray-500 dark:text-white/40 text-sm italic">
          <Battery className="w-4 h-4" />
          <span>{t.system.noUps}</span>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader icon={<Battery className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />} title={t.system.upsStatus} />
      <div className="flex items-center gap-6 mb-4">
        {data.batteryCharge !== null && <CircularGauge percent={data.batteryCharge} />}
        <div>
          {data.model && <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{data.model}</p>}
          {data.status && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-700 dark:text-green-400">
              {statusLabel[data.status] ?? data.status}
            </span>
          )}
          {data.batteryRuntime !== null && (
            <p className="text-xs text-gray-500 dark:text-white/40 mt-1">{t.system.runtime}: {formatRuntime(data.batteryRuntime)}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {data.inputVoltage !== null && (
          <div>
            <p className="text-xs text-gray-500 dark:text-white/40 uppercase tracking-wider">Input</p>
            <p className="font-mono text-sm text-gray-200">{data.inputVoltage}V</p>
          </div>
        )}
        {data.outputVoltage !== null && (
          <div>
            <p className="text-xs text-gray-500 dark:text-white/40 uppercase tracking-wider">Output</p>
            <p className="font-mono text-sm text-gray-200">{data.outputVoltage}V</p>
          </div>
        )}
        {data.loadPercent !== null && (
          <div>
            <p className="text-xs text-gray-500 dark:text-white/40 uppercase tracking-wider">{t.system.load}</p>
            <p className="font-mono text-sm text-gray-200">{data.loadPercent}%</p>
          </div>
        )}
      </div>
    </Card>
  )
}

// ─── Notifications Card ───────────────────────────────────────────────────────

const notifIcon: Record<Notification['type'], React.ReactNode> = {
  info: <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" />,
  error: <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />,
  success: <CheckCircle className="w-4 h-4 text-green-700 dark:text-green-400 shrink-0" />,
}

const notifBg: Record<Notification['type'], string> = {
  info: 'border-blue-500/20',
  warning: 'border-yellow-500/20',
  error: 'border-red-500/20',
  success: 'border-green-500/20',
}

function NotificationsCard({ notifications }: { notifications: Notification[] }) {
  const markRead = useMarkNotificationAsRead()
  const t = useT()

  const formatTime = (ts: number) =>
    new Date(ts * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  const unread = notifications.filter(n => !n.read).length

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <Bell className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm font-semibold uppercase tracking-wider">{t.system.notifications}</span>
        </div>
        {unread > 0 && (
          <span className="text-xs bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">
            {unread} {t.system.unread}
          </span>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-white/30 italic">{t.system.noNotifications}</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`rounded-lg border p-3 ${notifBg[notif.type]} ${!notif.read ? 'bg-black/5 dark:bg-white/5' : 'bg-transparent opacity-60'}`}
            >
              <div className="flex items-start gap-2">
                {notifIcon[notif.type]}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{notif.title}</p>
                  <p className="text-xs text-gray-600 dark:text-white/60 mt-0.5">{notif.message}</p>
                  <p className="text-xs text-gray-400 dark:text-white/30 mt-1">{formatTime(notif.createdAt)}</p>
                </div>
                {!notif.read && (
                  <button
                    onClick={() => markRead.mutate(notif.id)}
                    disabled={markRead.isPending}
                    className="p-1 rounded text-gray-400 dark:text-white/30 hover:text-green-700 dark:text-green-400 hover:bg-green-500/10 transition-colors shrink-0"
                    title={t.system.markAsRead}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── SystemView ───────────────────────────────────────────────────────────────

export function SystemView() {
  const infoQuery = useSystemInfo()
  const upsQuery = useUpsStatus()
  const notifQuery = useNotifications()
  const t = useT()

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.system.title}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mt-1">
          {t.system.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Info */}
        {infoQuery.isPending ? (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="w-24 h-4" />
            </div>
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-6 mb-2 w-full" />
            ))}
          </Card>
        ) : infoQuery.isError ? (
          <Card>
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>{t.system.failedToLoadInfo}</span>
            </div>
          </Card>
        ) : (
          <SystemInfoCard data={infoQuery.data!} />
        )}

        {/* UPS */}
        {upsQuery.isPending ? (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="w-20 h-4" />
            </div>
            <Skeleton className="h-20 w-20 rounded-full" />
          </Card>
        ) : upsQuery.isError ? (
          <Card>
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>{t.system.failedToLoadUps}</span>
            </div>
          </Card>
        ) : (
          <UpsCard data={upsQuery.data!} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notifications */}
        {notifQuery.isPending ? (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="w-24 h-4" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 mb-2 w-full rounded-lg" />
            ))}
          </Card>
        ) : (
          <NotificationsCard notifications={notifQuery.data ?? []} />
        )}

        {/* Updates */}
        <UpdatesCard />
      </div>

      {/* SSH toggle */}
      <SshToggleCard />

      {/* DB backup + integrity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DatabaseCard />
        <AuditLogCard />
      </div>

      {/* Notification channels config */}
      <NotificationsConfigCard />
    </div>
  )
}
