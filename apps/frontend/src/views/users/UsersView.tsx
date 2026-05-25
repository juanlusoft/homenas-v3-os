import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Users, Plus, Trash2, Key, Shield, ShieldOff, ShieldCheck, QrCode } from 'lucide-react'
import { useUsers, useDeleteUser } from '../../hooks/useUsers'
import { useAuthStore } from '../../stores/authStore'
import { authApi } from '../../api/auth'
import { CreateUserModal } from './CreateUserModal'
import { ChangePasswordModal } from './ChangePasswordModal'
import type { UserPublic } from '@homenas/shared'
import { useT } from '../../i18n/useT'

function RoleBadge({ role }: { role: 'admin' | 'user' }) {
  const t = useT()
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-400 font-medium">
        <Shield className="w-3 h-3" />
        {t.users.admin}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/50 font-medium">
      <ShieldOff className="w-3 h-3" />
      {t.users.user}
    </span>
  )
}


function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

interface UserRowProps {
  user: UserPublic
  currentUserId: number
  onChangePassword: (user: UserPublic) => void
  onDelete: (user: UserPublic) => void
}

function UserRow({ user, currentUserId, onChangePassword, onDelete }: UserRowProps) {
  const t = useT()
  return (
    <tr className="border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:bg-white/5 transition-colors">
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-gray-900 dark:text-white">{user.username}</span>
        {user.id === currentUserId && (
          <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-400">{t.users.you}</span>
        )}
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <RoleBadge role={user.role} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-white/50 hidden sm:table-cell">
        {formatDate(user.createdAt)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChangePassword(user)}
            className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
            title="Change password"
          >
            <Key className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(user)}
            disabled={user.id === currentUserId}
            className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={user.id === currentUserId ? t.users.cannotDeleteSelf : 'Delete user'}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}

function TotpCard() {
  const currentUser = useAuthStore((s) => s.user)
  const [setupData, setSetupData] = useState<{ secret: string; uri: string; qrDataUrl: string } | null>(null)
  const [confirmCode, setConfirmCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [showDisable, setShowDisable] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['totp-status'],
    queryFn: () => authApi.totp.status(),
    staleTime: 30_000,
  })

  const setupMut = useMutation({
    mutationFn: () => authApi.totp.setup(),
    onSuccess: (data) => { setSetupData(data); setMsg(null) },
    onError: (e) => setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Setup failed' }),
  })

  const enableMut = useMutation({
    mutationFn: () => authApi.totp.enable(confirmCode),
    onSuccess: () => { setSetupData(null); setConfirmCode(''); void refetchStatus(); setMsg({ type: 'ok', text: '2FA enabled successfully' }) },
    onError: (e) => setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Invalid code' }),
  })

  const disableMut = useMutation({
    mutationFn: () => authApi.totp.disable(disablePassword),
    onSuccess: () => { setShowDisable(false); setDisablePassword(''); void refetchStatus(); setMsg({ type: 'ok', text: '2FA disabled' }) },
    onError: (e) => setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Incorrect password' }),
  })

  const inputCls = 'w-full px-3 py-2 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors'

  return (
    <div className="bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 rounded-xl shadow-lg p-6 space-y-4">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-white">Two-Factor Authentication (2FA)</h2>
          <p className="text-sm text-gray-500 dark:text-white/40">Protect your account with a TOTP authenticator app (Google Authenticator, Authy…)</p>
        </div>
        {status && (
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${status.enabled ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/40'}`}>
            {status.enabled ? 'Enabled' : 'Disabled'}
          </span>
        )}
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
          {msg.text}
        </div>
      )}

      {/* Not enabled + no setup in progress */}
      {!status?.enabled && !setupData && (
        <button
          onClick={() => { setMsg(null); setupMut.mutate() }}
          disabled={setupMut.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          <QrCode className="w-4 h-4" />
          {setupMut.isPending ? 'Generating…' : 'Set up 2FA'}
        </button>
      )}

      {/* Setup in progress — show QR */}
      {setupData && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-white/60">
            Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
          </p>
          <div className="flex justify-center">
            <img src={setupData.qrDataUrl} alt="TOTP QR Code" className="rounded-lg border border-black/10 dark:border-white/10" />
          </div>
          <details className="text-xs text-gray-500 dark:text-white/40">
            <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-white/60">Manual entry key</summary>
            <code className="block mt-1 break-all font-mono">{setupData.secret}</code>
          </details>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className={`${inputCls} font-mono text-center tracking-widest`}
            />
            <button
              onClick={() => enableMut.mutate()}
              disabled={confirmCode.length !== 6 || enableMut.isPending}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {enableMut.isPending ? 'Verifying…' : 'Activate'}
            </button>
            <button
              onClick={() => { setSetupData(null); setConfirmCode('') }}
              className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Enabled — show disable option */}
      {status?.enabled && !showDisable && (
        <button
          onClick={() => { setMsg(null); setShowDisable(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
        >
          Disable 2FA
        </button>
      )}

      {status?.enabled && showDisable && (
        <div className="space-y-2">
          <p className="text-sm text-gray-600 dark:text-white/60">Enter your password to disable 2FA for <strong>{currentUser?.username}</strong>.</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Current password"
              className={inputCls}
            />
            <button
              onClick={() => disableMut.mutate()}
              disabled={!disablePassword || disableMut.isPending}
              className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/10 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {disableMut.isPending ? 'Disabling…' : 'Confirm'}
            </button>
            <button
              onClick={() => { setShowDisable(false); setDisablePassword('') }}
              className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function UsersView() {
  const t = useT()
  const { data: users, isLoading, error } = useUsers()
  const deleteUser = useDeleteUser()
  const currentUser = useAuthStore((s) => s.user)

  const [showCreate, setShowCreate] = useState(false)
  const [changePwTarget, setChangePwTarget] = useState<UserPublic | null>(null)
  const [showSelfPw, setShowSelfPw] = useState(false)

  const handleDelete = (user: UserPublic) => {
    if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return
    deleteUser.mutate(user.id)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.users.title}</h1>
          <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.users.subtitle}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-900 dark:text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t.users.createUser}
        </button>
      </div>

      {/* Users table */}
      <div className="bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 rounded-xl shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-black/10 dark:border-white/10 flex items-center gap-3">
          <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">{t.users.allUsers}</h2>
          {users && (
            <span className="ml-auto text-xs text-gray-500 dark:text-white/40">{users.length} user{users.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-gray-500 dark:text-white/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left font-medium">{t.users.username}</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">{t.users.role}</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">{t.users.created}</th>
                <th className="px-4 py-3 text-left font-medium">{t.users.actions}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-black/5 dark:border-white/5">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-black/10 dark:bg-white/10 rounded animate-pulse w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              )}
              {error && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-red-600 dark:text-red-400 text-sm">
                    Failed to load users
                  </td>
                </tr>
              )}
              {users?.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  currentUserId={currentUser?.id ?? -1}
                  onChangePassword={setChangePwTarget}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Change My Password section */}
      <div className="bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">{t.users.changeMyPassword}</h2>
            <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.users.updatePassword}</p>
          </div>
          <button
            onClick={() => setShowSelfPw(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-white/70 bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:bg-white/15 transition-colors"
          >
            <Key className="w-4 h-4" />
            {t.users.changePassword}
          </button>
        </div>
      </div>

      {/* 2FA card (own account only) */}
      <TotpCard />

      {/* Modals */}
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}

      {changePwTarget && (
        <ChangePasswordModal
          mode="admin"
          targetUserId={changePwTarget.id}
          targetUsername={changePwTarget.username}
          onClose={() => setChangePwTarget(null)}
        />
      )}

      {showSelfPw && (
        <ChangePasswordModal
          mode="self"
          onClose={() => setShowSelfPw(false)}
        />
      )}
    </div>
  )
}
