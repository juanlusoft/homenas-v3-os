import { useRef, useEffect, useState } from 'react'
import {
  Shield,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  Download,
  Play,
  Square,
  RotateCcw,
  Plus,
  Trash2,
  Key,
  UserCheck,
  UserX,
  Users,
  Monitor,
  ChevronDown,
  ChevronRight,
  UserPlus,
  X,
} from 'lucide-react'
import {
  useADStatus,
  useADInstallProgress,
  useStartADInstall,
  useProvisionDomain,
  useADServiceControl,
  useADUsers,
  useCreateADUser,
  useDeleteADUser,
  useEnableADUser,
  useDisableADUser,
  useResetADPassword,
  useADGroups,
  useCreateADGroup,
  useDeleteADGroup,
  useAddADMember,
  useRemoveADMember,
  useADComputers,
} from '../../hooks/useActiveDirectory'
import type { ADUser, ADGroup } from '../../api/active-directory'
import { useT } from '../../i18n/useT'

// ─── Error parser ─────────────────────────────────────────────────────────────

function parseApiError(err: unknown): string {
  if (!(err instanceof Error)) return 'Error desconocido'
  try {
    const parsed = JSON.parse(err.message) as { message?: string; error?: string }
    const raw = parsed.message ?? parsed.error ?? err.message
    // Take only first line, truncated to 150 chars
    return raw.split('\n')[0]?.slice(0, 150) ?? 'Error desconocido'
  } catch {
    return err.message.slice(0, 150)
  }
}

// ─── Shared small components ──────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-black/10 dark:bg-white/10 rounded ${className}`} />
}

function StatusRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500 dark:text-white/40 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle className="w-3.5 h-3.5 text-green-700 dark:text-green-400" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-gray-400 dark:text-white/30" />
        )}
        <span className="font-mono text-xs text-gray-600 dark:text-gray-300">{value}</span>
      </div>
    </div>
  )
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 ${className}`}>
      {children}
    </div>
  )
}

function ActionBtn({
  onClick,
  disabled,
  loading,
  variant = 'default',
  children,
  title,
}: {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'default' | 'danger' | 'success' | 'ghost'
  children: React.ReactNode
  title?: string
}) {
  const base = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const variants = {
    default: 'bg-indigo-500 hover:bg-indigo-600 text-white',
    danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30',
    success: 'bg-green-500/10 hover:bg-green-500/20 text-green-700 dark:text-green-400 border border-green-500/30',
    ghost: 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:bg-white/5',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`${base} ${variants[variant]}`}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  )
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 dark:border-white/10">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{title}</h3>
          <button onClick={onClose} className="text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function FormField({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-white/50 mb-1.5 uppercase tracking-wider">
        {label}{required && <span className="text-red-600 dark:text-red-400 ml-1">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-colors"
      />
    </div>
  )
}

// ─── Install section ──────────────────────────────────────────────────────────

function InstallSection() {
  const installMutation = useStartADInstall()
  const { data: progress } = useADInstallProgress()
  const logRef = useRef<HTMLDivElement>(null)
  const isInstalling = progress?.running === true

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
    // React Query returns a fresh array reference on every poll even when the
    // contents are unchanged — depending on the array itself would scroll on
    // every refetch (every 2s). Tracking the length is a cheap proxy that only
    // fires when the log actually grows.
  }, [progress?.output?.length])

  return (
    <SectionCard className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">Install Samba AD DC</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-white/50 mb-5">
        Samba is not installed. Install the required packages to turn this NAS into an Active Directory Domain Controller.
      </p>
      <p className="text-xs text-gray-400 dark:text-white/30 mb-5 font-mono bg-black/30 rounded-lg px-3 py-2">
        apt-get install samba krb5-config winbind samba-dsdb-modules samba-vfs-modules
      </p>

      {(isInstalling || (progress?.output && progress.output.length > 0)) && (
        <div className="mb-5">
          <div
            ref={logRef}
            className="bg-black/40 rounded-lg p-3 font-mono text-xs text-green-700 dark:text-green-400 max-h-56 overflow-y-auto"
          >
            {progress?.output?.map((line, i) => (
              <div key={i} className="leading-relaxed">{line}</div>
            ))}
          </div>
          {progress?.error && (
            <div className="mt-2 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{progress.error}</span>
            </div>
          )}
          {progress?.completed && (
            <div className="mt-2 flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>Installation completed. Reload the page to continue.</span>
            </div>
          )}
        </div>
      )}

      {!isInstalling && !progress?.completed && (
        <ActionBtn
          onClick={() => installMutation.mutate()}
          loading={installMutation.isPending}
        >
          <Download className="w-3.5 h-3.5" />
          Install Samba AD DC
        </ActionBtn>
      )}
      {isInstalling && (
        <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Installing packages...</span>
        </div>
      )}
    </SectionCard>
  )
}

// ─── Provision section ────────────────────────────────────────────────────────

function ProvisionSection() {
  const provisionMutation = useProvisionDomain()
  const [domain, setDomain] = useState('')
  const [realm, setRealm] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!/^[a-zA-Z0-9]{1,15}$/.test(domain)) {
      setFormError('Domain must be 1-15 alphanumeric characters (NetBIOS name, e.g. CORP)')
      return
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{2,63}$/.test(realm) || !realm.includes('.')) {
      setFormError('Realm must be a FQDN (e.g. CORP.EXAMPLE.COM)')
      return
    }
    if (adminPassword.length < 8) {
      setFormError('Administrator password must be at least 8 characters')
      return
    }
    if (adminPassword !== confirmPassword) {
      setFormError('Passwords do not match')
      return
    }

    provisionMutation.mutate({ domain: domain.toUpperCase(), realm: realm.toUpperCase(), adminPassword })
  }

  return (
    <SectionCard className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">Provision Domain</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-white/50 mb-5">
        Configure this server as an Active Directory Domain Controller. This operation cannot be undone — provision carefully.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="NetBIOS Domain Name"
          value={domain}
          onChange={setDomain}
          placeholder="CORP"
          required
        />
        <FormField
          label="Realm (FQDN)"
          value={realm}
          onChange={setRealm}
          placeholder="CORP.EXAMPLE.COM"
          required
        />
        <FormField
          label="Administrator Password"
          type="password"
          value={adminPassword}
          onChange={setAdminPassword}
          placeholder="Min. 8 characters"
          required
        />
        <FormField
          label="Confirm Password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Repeat password"
          required
        />

        {(formError || provisionMutation.error) && (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{formError ?? (provisionMutation.error instanceof Error ? provisionMutation.error.message : 'Provision failed')}</span>
          </div>
        )}

        {provisionMutation.isSuccess && (
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
            <CheckCircle className="w-4 h-4" />
            <span>Domain provisioned successfully. Start the service to activate.</span>
          </div>
        )}

        <button
          type="submit"
          disabled={provisionMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-gray-900 dark:text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {provisionMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          <Shield className="w-4 h-4" />
          Provision Domain
        </button>
      </form>
    </SectionCard>
  )
}

// ─── Service control bar ──────────────────────────────────────────────────────

function ServiceControlBar({ serviceActive }: { serviceActive: boolean }) {
  const t = useT()
  const { start, stop, restart } = useADServiceControl()
  const busy = start.isPending || stop.isPending || restart.isPending

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500 dark:text-white/40 uppercase tracking-wider mr-1">{t.activeDirectory.service}:</span>
      <ActionBtn
        onClick={() => start.mutate()}
        disabled={serviceActive || busy}
        loading={start.isPending}
        variant="success"
      >
        <Play className="w-3.5 h-3.5" />
        {t.common.start}
      </ActionBtn>
      <ActionBtn
        onClick={() => stop.mutate()}
        disabled={!serviceActive || busy}
        loading={stop.isPending}
        variant="danger"
      >
        <Square className="w-3.5 h-3.5" />
        {t.common.stop}
      </ActionBtn>
      <ActionBtn
        onClick={() => restart.mutate()}
        disabled={busy}
        loading={restart.isPending}
        variant="ghost"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        {t.common.restart}
      </ActionBtn>
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const createMutation = useCreateADUser()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^[a-zA-Z0-9_-]{1,20}$/.test(username)) {
      setError('Username: 1-20 chars, letters/digits/underscore/hyphen only')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    createMutation.mutate({ username, password, displayName }, {
      onSuccess: () => onClose(),
      onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create user'),
    })
  }

  return (
    <Modal title="Create AD User" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Username" value={username} onChange={setUsername} placeholder="jdoe" required />
        <FormField label="Display Name" value={displayName} onChange={setDisplayName} placeholder="John Doe" />
        <FormField label="Password" type="password" value={password} onChange={setPassword} placeholder="Min. 8 characters" required />
        {error && (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-gray-900 dark:text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create User
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPasswordModal({ username, onClose }: { username: string; onClose: () => void }) {
  const resetMutation = useResetADPassword()
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    resetMutation.mutate({ username, newPassword }, {
      onSuccess: () => onClose(),
      onError: (err) => setError(err instanceof Error ? err.message : 'Failed to reset password'),
    })
  }

  return (
    <Modal title={`Reset Password — ${username}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="New Password" type="password" value={newPassword} onChange={setNewPassword} placeholder="Min. 8 characters" required />
        {error && (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={resetMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-gray-900 dark:text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resetMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Reset Password
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const createMutation = useCreateADGroup()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim() || name.length > 64) {
      setError('Group name must be 1-64 characters')
      return
    }
    createMutation.mutate(name.trim(), {
      onSuccess: () => onClose(),
      onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create group'),
    })
  }

  return (
    <Modal title="Create AD Group" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Group Name" value={name} onChange={setName} placeholder="Domain Users" required />
        {error && (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-gray-900 dark:text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Group
          </button>
        </div>
      </form>
    </Modal>
  )
}

function AddMemberModal({ group, onClose }: { group: string; onClose: () => void }) {
  const addMutation = useAddADMember()
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^[a-zA-Z0-9_-]{1,20}$/.test(username)) {
      setError('Username: 1-20 chars, letters/digits/underscore/hyphen only')
      return
    }
    addMutation.mutate({ group, username }, {
      onSuccess: () => onClose(),
      onError: (err) => setError(err instanceof Error ? err.message : 'Failed to add member'),
    })
  }

  return (
    <Modal title={`Add Member to ${group}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Username" value={username} onChange={setUsername} placeholder="jdoe" required />
        {error && (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={addMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-gray-900 dark:text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Member
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'users' | 'groups' | 'computers'

function UsersTab() {
  const t = useT()
  const { data: users, isLoading, error } = useADUsers()
  const deleteMutation = useDeleteADUser()
  const enableMutation = useEnableADUser()
  const disableMutation = useDisableADUser()
  const [showCreate, setShowCreate] = useState(false)
  const [resetTarget, setResetTarget] = useState<ADUser | null>(null)

  const handleDelete = (user: ADUser) => {
    if (!window.confirm(t.activeDirectory.deleteUserConfirm(user.username))) return
    deleteMutation.mutate(user.username)
  }

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 dark:border-white/10">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t.activeDirectory.adUsers}</h3>
          {users && <span className="text-xs text-gray-400 dark:text-white/30 ml-1">{users.length} user{users.length !== 1 ? 's' : ''}</span>}
        </div>
        <ActionBtn onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5" />
          {t.activeDirectory.newUser}
        </ActionBtn>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-gray-500 dark:text-white/40 text-xs uppercase tracking-wider">
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.username}</th>
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.displayName}</th>
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.status}</th>
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.email}</th>
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.actions}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-5 py-3">
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            )}
            {error && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-red-600 dark:text-red-400 text-sm">
                  {t.activeDirectory.failedToLoadUsers}: {parseApiError(error)}
                </td>
              </tr>
            )}
            {users?.map((user) => (
              <tr key={user.username} className="border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:bg-white/5 transition-colors">
                <td className="px-5 py-3">
                  <span className="font-medium text-gray-900 dark:text-white">{user.username}</span>
                </td>
                <td className="px-5 py-3 text-gray-600 dark:text-white/60">{user.displayName ?? '—'}</td>
                <td className="px-5 py-3">
                  {user.enabled ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400 font-medium">
                      <CheckCircle className="w-3 h-3" />
                      Enabled
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-gray-400 dark:text-white/30 font-medium">
                      <XCircle className="w-3 h-3" />
                      Disabled
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-500 dark:text-white/50 font-mono text-xs">{user.email ?? '—'}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setResetTarget(user)}
                      title="Reset password"
                      className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
                    >
                      <Key className="w-3.5 h-3.5" />
                    </button>
                    {user.enabled ? (
                      <button
                        onClick={() => disableMutation.mutate(user.username)}
                        disabled={disableMutation.isPending}
                        title="Disable user"
                        className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-30"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => enableMutation.mutate(user.username)}
                        disabled={enableMutation.isPending}
                        title="Enable user"
                        className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-green-700 dark:text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-30"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(user)}
                      disabled={user.username.toLowerCase() === 'administrator'}
                      title={user.username.toLowerCase() === 'administrator' ? 'Cannot delete Administrator' : 'Delete user'}
                      className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-gray-400 dark:text-white/30 text-sm">
                  No AD users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
      {resetTarget && <ResetPasswordModal username={resetTarget.username} onClose={() => setResetTarget(null)} />}
    </div>
  )
}

function GroupRow({ group }: { group: ADGroup }) {
  const t = useT()
  const deleteMutation = useDeleteADGroup()
  const removeMemberMutation = useRemoveADMember()
  const [expanded, setExpanded] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)

  const handleDelete = () => {
    if (!window.confirm(`Delete group "${group.name}"?`)) return
    deleteMutation.mutate(group.name)
  }

  return (
    <>
      <tr className="border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:bg-white/5 transition-colors">
        <td className="px-5 py-3">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white hover:text-indigo-700 dark:text-indigo-300 transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500 dark:text-white/40" />}
            {group.name}
          </button>
        </td>
        <td className="px-5 py-3 text-gray-500 dark:text-white/50 text-xs">{group.members.length} member{group.members.length !== 1 ? 's' : ''}</td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAddMember(true)}
              title="Add member"
              className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              title="Delete group"
              className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && group.members.length > 0 && (
        <tr className="border-b border-black/5 dark:border-white/5 bg-white/2">
          <td colSpan={3} className="px-8 py-2">
            <div className="flex flex-wrap gap-2">
              {group.members.map((member) => (
                <div
                  key={member}
                  className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-white/60 bg-black/5 dark:bg-white/5 rounded-lg px-2.5 py-1 border border-black/5 dark:border-white/5"
                >
                  <span className="font-mono">{member}</span>
                  <button
                    onClick={() => removeMemberMutation.mutate({ group: group.name, username: member })}
                    disabled={removeMemberMutation.isPending}
                    className="text-gray-400 dark:text-white/20 hover:text-red-600 dark:text-red-400 transition-colors ml-0.5"
                    title={`Remove ${member} from group`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
      {expanded && group.members.length === 0 && (
        <tr className="border-b border-black/5 dark:border-white/5 bg-white/2">
          <td colSpan={3} className="px-8 py-2 text-xs text-gray-400 dark:text-white/30 italic">
            {t.activeDirectory.noMembers}
          </td>
        </tr>
      )}
      {showAddMember && <AddMemberModal group={group.name} onClose={() => setShowAddMember(false)} />}
    </>
  )
}

function GroupsTab() {
  const t = useT()
  const { data: groups, isLoading, error } = useADGroups()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 dark:border-white/10">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t.activeDirectory.adGroups}</h3>
          {groups && <span className="text-xs text-gray-400 dark:text-white/30 ml-1">{groups.length} group{groups.length !== 1 ? 's' : ''}</span>}
        </div>
        <ActionBtn onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5" />
          {t.activeDirectory.newGroup}
        </ActionBtn>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-gray-500 dark:text-white/40 text-xs uppercase tracking-wider">
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.groups}</th>
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.members}</th>
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.actions}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <td key={j} className="px-5 py-3">
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            )}
            {error && (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-center text-red-600 dark:text-red-400 text-sm">
                  {t.activeDirectory.failedToLoadGroups}
                </td>
              </tr>
            )}
            {groups?.map((group) => (
              <GroupRow key={group.name} group={group} />
            ))}
            {groups?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-gray-400 dark:text-white/30 text-sm">
                  {t.activeDirectory.adGroups}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function ComputersTab() {
  const t = useT()
  const { data: computers, isLoading, error } = useADComputers()

  return (
    <div>
      <div className="flex items-center gap-2 px-5 py-4 border-b border-black/10 dark:border-white/10">
        <Monitor className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t.activeDirectory.adComputers}</h3>
        {computers && <span className="text-xs text-gray-400 dark:text-white/30 ml-1">{computers.length} computer{computers.length !== 1 ? 's' : ''}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-gray-500 dark:text-white/40 text-xs uppercase tracking-wider">
              <th className="px-5 py-3 text-left font-medium">{t.activeDirectory.computers}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5">
                  <td className="px-5 py-3">
                    <Skeleton className="h-4 w-1/3" />
                  </td>
                </tr>
              ))
            )}
            {error && (
              <tr>
                <td className="px-5 py-6 text-center text-red-600 dark:text-red-400 text-sm">
                  {t.activeDirectory.failedToLoadComputers}
                </td>
              </tr>
            )}
            {computers?.map((computer) => (
              <tr key={computer.name} className="border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:bg-white/5 transition-colors">
                <td className="px-5 py-3 flex items-center gap-2">
                  <Monitor className="w-3.5 h-3.5 text-gray-400 dark:text-white/30" />
                  <span className="font-mono text-white/80">{computer.name}</span>
                </td>
              </tr>
            ))}
            {computers?.length === 0 && (
              <tr>
                <td className="px-5 py-8 text-center text-gray-400 dark:text-white/30 text-sm">
                  {t.activeDirectory.adComputers}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ActiveDirectoryView() {
  const t = useT()
  const { data: status, isPending, isError } = useADStatus()
  const [activeTab, setActiveTab] = useState<Tab>('users')

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'users', label: t.activeDirectory.users, icon: Users },
    { id: 'groups', label: t.activeDirectory.groups, icon: Shield },
    { id: 'computers', label: t.activeDirectory.computers, icon: Monitor },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.activeDirectory.title}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mt-1">
          {t.activeDirectory.subtitle}
        </p>
      </div>

      {isPending ? (
        <SectionCard className="p-5 space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="w-4 h-4 rounded" />
            <Skeleton className="w-32 h-4" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </SectionCard>
      ) : isError ? (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{t.activeDirectory.failedToLoadStatus}</span>
        </div>
      ) : (
        <>
          {/* Status card */}
          <SectionCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">{t.activeDirectory.status}</span>
              </div>
              {status!.domainProvisioned && (
                <ServiceControlBar serviceActive={status!.serviceActive} />
              )}
            </div>

            <div className="space-y-2 mb-2">
              <StatusRow
                label={t.activeDirectory.sambaInstalled}
                ok={status!.sambaInstalled}
                value={status!.sambaInstalled ? t.activeDirectory.installed : t.homestore.notInstalled}
              />
              <StatusRow
                label={t.activeDirectory.domainProvisioned}
                ok={status!.domainProvisioned}
                value={
                  status!.domainProvisioned && status!.domain
                    ? `${status!.domain}${status!.realm ? ` (${status!.realm})` : ''}`
                    : 'Not provisioned'
                }
              />
              <StatusRow
                label={t.activeDirectory.service}
                ok={status!.serviceActive}
                value={status!.serviceActive ? 'Active (samba-ad-dc)' : t.common.inactive}
              />
            </div>
          </SectionCard>

          {/* Install section — when samba not present */}
          {!status!.sambaInstalled && <InstallSection />}

          {/* Provision section — samba installed but not provisioned */}
          {status!.sambaInstalled && !status!.domainProvisioned && <ProvisionSection />}

          {/* Main management panel — provisioned domain */}
          {status!.domainProvisioned && (
            <SectionCard className="overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-black/10 dark:border-white/10 bg-white/2">
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === id
                        ? 'border-indigo-400 text-indigo-700 dark:text-indigo-300'
                        : 'border-transparent text-gray-500 dark:text-white/40 hover:text-gray-700 dark:text-white/70'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {activeTab === 'users' && <UsersTab />}
              {activeTab === 'groups' && <GroupsTab />}
              {activeTab === 'computers' && <ComputersTab />}
            </SectionCard>
          )}
        </>
      )}
    </div>
  )
}
