import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useSetupStatus } from './hooks/useSetup'
import { AppLayout } from './components/layout/AppLayout'
import { SetupGuard } from './components/SetupGuard'
import { PageSpinner } from './components/PageSpinner'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const { data: setupStatus, isSuccess, isError } = useSetupStatus()

  if (!isAuthenticated) {
    // If setup status request failed (backend down, network error, etc.),
    // fall back to the login screen instead of spinning forever.
    if (isError) return <Navigate to="/login" replace />
    if (!isSuccess) return <PageSpinner />
    // Defensive: backend may return null/{} on unexpected payloads
    if (!setupStatus?.complete) return <Navigate to="/setup" replace />
    return <Navigate to="/login" replace />
  }

  return <SetupGuard>{children}</SetupGuard>
}

export const router = createBrowserRouter([
  {
    path: '/login',
    HydrateFallback: PageSpinner,
    lazy: () => import('./views/auth/LoginView').then((m) => ({ Component: m.LoginView })),
  },
  {
    path: '/setup',
    HydrateFallback: PageSpinner,
    lazy: () => import('./views/setup/SetupWizard').then((m) => ({ Component: m.SetupWizard })),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        HydrateFallback: PageSpinner,
        lazy: () => import('./views/dashboard/DashboardView').then((m) => ({ Component: m.DashboardView })),
      },
      { path: 'storage',          HydrateFallback: PageSpinner, lazy: () => import('./views/storage/StorageView').then(m => ({ Component: m.StorageView })) },
      { path: 'docker',           HydrateFallback: PageSpinner, lazy: () => import('./views/docker/DockerView').then(m => ({ Component: m.DockerView })) },
      { path: 'network',          HydrateFallback: PageSpinner, lazy: () => import('./views/network/NetworkView').then(m => ({ Component: m.NetworkView })) },
      { path: 'system',           HydrateFallback: PageSpinner, lazy: () => import('./views/system/SystemView').then(m => ({ Component: m.SystemView })) },
      { path: 'users',            HydrateFallback: PageSpinner, lazy: () => import('./views/users/UsersView').then(m => ({ Component: m.UsersView })) },
      { path: 'scheduler',        HydrateFallback: PageSpinner, lazy: () => import('./views/scheduler/SchedulerView').then(m => ({ Component: m.SchedulerView })) },
      { path: 'backup',           HydrateFallback: PageSpinner, lazy: () => import('./views/backup/BackupView').then(m => ({ Component: m.BackupView })) },
      { path: 'homestore',        HydrateFallback: PageSpinner, lazy: () => import('./views/homestore/HomeStoreView').then(m => ({ Component: m.HomeStoreView })) },
      { path: 'syncthing',        HydrateFallback: PageSpinner, lazy: () => import('./views/syncthing/SyncthingView').then(m => ({ Component: m.SyncthingView })) },
      { path: 'cloud-backup',     HydrateFallback: PageSpinner, lazy: () => import('./views/cloud-backup/CloudBackupView').then(m => ({ Component: m.CloudBackupView })) },
      { path: 'files',            HydrateFallback: PageSpinner, lazy: () => import('./views/files/FilesView').then(m => ({ Component: m.FilesView })) },
      { path: 'network-drives',   HydrateFallback: PageSpinner, lazy: () => import('./views/network-drives/NetworkDrivesView').then(m => ({ Component: m.NetworkDrivesView })) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
