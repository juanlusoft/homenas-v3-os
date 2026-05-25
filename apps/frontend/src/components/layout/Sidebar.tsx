import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  HardDrive,
  Container,
  Network,
  Users,
  Archive,
  Calendar,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ShoppingBag,
  Building2,
  Shield,
  RefreshCw,
  Cloud,
  Folder,
  Globe,
  Loader2,
  Sun,
  Moon,
  Languages,
  Power,
} from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { useQuery } from '@tanstack/react-query'
import { systemApi } from '../../api/system'
import { authApi } from '../../api/auth'
import { useUpdateStatus, useUpdateApp, useUpdateProcess } from '../../hooks/useUpdates'
import { useT } from '../../i18n/useT'
import { cn } from '../../lib/utils'

const NAV_ROUTES = [
  { key: 'dashboard'       as const, icon: LayoutDashboard,  to: '/' },
  { key: 'storage'         as const, icon: HardDrive,        to: '/storage' },
  { key: 'files'           as const, icon: Folder,           to: '/files' },
  { key: 'networkDrives'   as const, icon: Globe, to: '/network-drives' },
  { key: 'docker'          as const, icon: Container,        to: '/docker' },
  { key: 'homestore'       as const, icon: ShoppingBag,      to: '/homestore' },
  { key: 'network'         as const, icon: Network,          to: '/network' },
  { key: 'syncthing'       as const, icon: RefreshCw,        to: '/syncthing' },
  { key: 'cloudBackup'     as const, icon: Cloud,            to: '/cloud-backup' },
  { key: 'activeBackup'    as const, icon: Shield,           to: '/active-backup' },
  { key: 'activeDirectory' as const, icon: Building2,        to: '/active-directory' },
  { key: 'users'           as const, icon: Users,            to: '/users' },
  { key: 'backup'          as const, icon: Archive,          to: '/backup' },
  { key: 'scheduler'       as const, icon: Calendar,         to: '/scheduler' },
  { key: 'system'          as const, icon: Settings,         to: '/system' },
]

export function Sidebar() {
  const collapsed    = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const theme        = useUIStore((s) => s.theme)
  const toggleTheme  = useUIStore((s) => s.toggleTheme)
  const lang         = useUIStore((s) => s.lang)
  const toggleLang   = useUIStore((s) => s.toggleLang)
  const user         = useAuthStore((s) => s.user)
  const logout       = useAuthStore((s) => s.logout)
  const t            = useT()

  const { data: sysInfo } = useQuery({
    queryKey: ['system', 'info'],
    queryFn: () => systemApi.getInfo(),
    staleTime: Infinity,
  })
  const { data: updateStatus } = useUpdateStatus()
  const updateApp = useUpdateApp()
  const hasUpdate  = (updateStatus?.app.pendingCommits.length ?? 0) > 0
  // Only poll the (relatively expensive) update process when we know an update
  // is pending or we've just kicked one off. Once it returns status='updating'
  // we keep polling because the hook stays enabled while isUpdating is true.
  const { data: process } = useUpdateProcess({ enabled: hasUpdate || updateApp.isPending })
  const isUpdating = process?.status === 'updating' || updateApp.isPending
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const [confirmReboot, setConfirmReboot] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleConfirmUpdate = () => {
    setConfirmUpdate(false)
    setUpdateError(null)
    updateApp.mutate(undefined, {
      onSuccess: () => navigate('/system'),
      onError: (err) => {
        setUpdateError(err instanceof Error ? err.message : String(err))
      },
    })
  }

  const handleLogout = async () => {
    try { await authApi.logout() } catch { /* ignore */ }
    logout()
    navigate('/login', { replace: true })
  }

  const handleReboot = async () => {
    setConfirmReboot(false)
    try { await systemApi.reboot() } catch { /* ignore — server will restart */ }
  }

  const navItems = NAV_ROUTES.map(({ key, icon, to }) => ({
    label: t.nav[key],
    icon,
    to,
  }))

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-full z-40 flex flex-col',
        'bg-white/95 dark:bg-gray-900/95 backdrop-blur border-r border-black/5 dark:border-white/5',
        'transition-all duration-200 ease-in-out',
        collapsed ? 'w-16 -translate-x-full md:translate-x-0' : 'w-56 translate-x-0'
      )}
    >
      {/* Header */}
      <div className={cn(
        'flex items-center h-14 px-3 border-b border-black/5 dark:border-white/5 shrink-0',
        collapsed ? 'justify-center' : 'justify-between'
      )}>
        {!collapsed && (
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            Home<span className="text-indigo-600 dark:text-indigo-400">Nas</span> OS
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {navItems.map(({ label, icon: Icon, to }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors group',
                isActive
                  ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:hover:bg-white/5',
                collapsed && 'justify-center px-2'
              )
            }
            title={collapsed ? label : undefined}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Update error toast (only when collapsed banner can't show it inline) */}
      {updateError && !collapsed && (
        <div className="shrink-0 mx-2 mb-1 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30">
          <p className="text-xs text-red-700 dark:text-red-300 font-medium leading-snug break-words">
            {updateError}
          </p>
          <button
            onClick={() => setUpdateError(null)}
            className="mt-1 text-[10px] text-red-700/80 dark:text-red-300/80 hover:text-red-700 dark:hover:text-red-300 underline underline-offset-2"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Update available banner */}
      {(hasUpdate || isUpdating) && (
        <div className="shrink-0 mx-2 mb-1">
          {isUpdating ? (
            <button
              onClick={() => navigate('/system')}
              className={cn(
                'w-full flex items-center gap-2 rounded-lg px-3 py-2',
                'bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors',
                collapsed && 'justify-center px-2'
              )}
              title={t.updates.updating}
            >
              <Loader2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 animate-spin" />
              {!collapsed && <span className="text-xs text-indigo-700 dark:text-indigo-300 font-medium truncate">{t.updates.updating}</span>}
            </button>
          ) : confirmUpdate ? (
            collapsed ? (
              <button
                onClick={handleConfirmUpdate}
                className="w-full flex justify-center items-center rounded-lg px-2 py-2 bg-indigo-600/30 border border-indigo-500/50 hover:bg-indigo-600/50 transition-colors"
                title={t.common.confirm}
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-700 dark:text-indigo-300" />
              </button>
            ) : (
              <div className="rounded-lg px-3 py-2 bg-indigo-500/15 border border-indigo-500/30 space-y-2">
                <p className="text-xs text-indigo-800 dark:text-indigo-200 font-medium">{t.updates.updateNow}?</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleConfirmUpdate}
                    className="flex-1 text-xs py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                  >
                    {t.common.yes}
                  </button>
                  <button
                    onClick={() => setConfirmUpdate(false)}
                    className="flex-1 text-xs py-1 rounded-md bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 transition-colors"
                  >
                    {t.common.no}
                  </button>
                </div>
              </div>
            )
          ) : (
            <button
              onClick={() => setConfirmUpdate(true)}
              className={cn(
                'w-full flex items-center gap-2 rounded-lg px-3 py-2',
                'bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors',
                collapsed && 'justify-center px-2'
              )}
              title={t.updates.available}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0 animate-pulse" />
              {!collapsed && (
                <span className="text-xs text-indigo-700 dark:text-indigo-300 font-medium truncate">{t.updates.available}</span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Homelabs Club logo */}
      <div className="shrink-0 flex justify-center items-center px-2 py-2 border-t border-black/5 dark:border-white/5 opacity-50 hover:opacity-80 transition-opacity">
        <a href="https://homelabs.club" target="_blank" rel="noopener noreferrer" tabIndex={-1}>
          <img
            src="/logo.svg"
            alt="Homelabs Club"
            className={cn('object-contain w-full', collapsed ? 'w-8 h-8' : 'h-auto')}
          />
        </a>
      </div>

      {/* User / controls / Logout */}
      <div className={cn(
        'shrink-0 border-t border-black/5 dark:border-white/5 p-2 space-y-1',
      )}>
        {/* User info */}
        {!collapsed && user && (
          <div className="px-2.5 py-1.5">
            <p className="text-xs font-medium text-gray-700 dark:text-white/70 truncate">{user.username}</p>
            <p className="text-xs text-gray-400 dark:text-white/30 capitalize">{user.role}</p>
            {sysInfo?.appVersion && (
              <p className="text-xs text-gray-400 dark:text-white/20 font-mono mt-0.5">v{sysInfo.appVersion}</p>
            )}
          </div>
        )}

        {/* Theme + Language toggles */}
        <div className={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'px-1')}>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors',
              'text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 hover:bg-black/5 dark:hover:bg-white/5',
              collapsed ? 'justify-center w-full' : 'flex-1'
            )}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          >
            {theme === 'dark'
              ? <Sun className="w-4 h-4 shrink-0" />
              : <Moon className="w-4 h-4 shrink-0" />
            }
            {!collapsed && (
              <span>{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
            )}
          </button>

          {/* Language toggle */}
          <button
            onClick={toggleLang}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors',
              'text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 hover:bg-black/5 dark:hover:bg-white/5',
              collapsed ? 'justify-center w-full' : 'flex-1'
            )}
            title={lang === 'es' ? 'Switch to English' : 'Cambiar a Español'}
          >
            <Languages className="w-4 h-4 shrink-0" />
            {!collapsed && <span>{lang === 'es' ? 'ES' : 'EN'}</span>}
          </button>
        </div>

        {/* Reboot */}
        {confirmReboot ? (
          collapsed ? (
            <button
              onClick={handleReboot}
              className="flex w-full justify-center items-center rounded-lg px-2 py-2 bg-orange-500/20 border border-orange-500/40 hover:bg-orange-500/30 transition-colors"
              title={t.common.confirm}
            >
              <Power className="w-3.5 h-3.5 text-orange-500" />
            </button>
          ) : (
            <div className="rounded-lg px-3 py-2 bg-orange-500/10 border border-orange-500/30 space-y-2">
              <p className="text-xs text-orange-700 dark:text-orange-300 font-medium">{t.nav.rebootConfirm}</p>
              <div className="flex gap-1.5">
                <button
                  onClick={handleReboot}
                  className="flex-1 text-xs py-1 rounded-md bg-orange-500 hover:bg-orange-400 text-white font-medium transition-colors"
                >
                  {t.common.yes}
                </button>
                <button
                  onClick={() => setConfirmReboot(false)}
                  className="flex-1 text-xs py-1 rounded-md bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-white/50 transition-colors"
                >
                  {t.common.no}
                </button>
              </div>
            </div>
          )
        ) : (
          <button
            onClick={() => setConfirmReboot(true)}
            className={cn(
              'flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-orange-500/10 transition-colors w-full',
              collapsed && 'justify-center px-2'
            )}
            title={collapsed ? t.nav.reboot : undefined}
          >
            <Power className="w-4 h-4 shrink-0" />
            {!collapsed && <span>{t.nav.reboot}</span>}
          </button>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className={cn(
            'flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors w-full',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? t.nav.logout : undefined}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>{t.nav.logout}</span>}
        </button>
      </div>
    </aside>
  )
}
