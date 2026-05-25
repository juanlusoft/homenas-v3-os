import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Server, CheckCircle, Loader2,
  Lock, Wifi, HardDrive, AlertTriangle, User,
} from 'lucide-react'
import {
  useCompleteSetup, useSetupAccount,
  useSetupNetwork, useConfigureNetwork, useConfigurePool,
} from '../../hooks/useSetup'
import { useAuthStore } from '../../stores/authStore'
import { setupApi } from '../../api/setup'
import { PageSpinner } from '../../components/PageSpinner'

type Step = 1 | 2 | 3 | 4 | 5

// ── Step indicators ───────────────────────────────────────────────────────────
// Flat structure: indicator — connector — indicator — connector …
// All circles sit at the same row; labels hang below uniformly.

function StepIndicators({ labels, current }: { labels: string[]; current: Step }) {
  return (
    <div className="flex items-start mb-8">
      {labels.map((label, i) => {
        const n       = i + 1
        const isDone  = n < current
        const isNow   = n === current
        return (
          <div key={n} className="flex items-start flex-1">
            {/* Circle + label */}
            <div className="flex flex-col items-center min-w-0 w-12 shrink-0">
              <div className={[
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors shrink-0',
                isDone ? 'bg-green-500 text-white' : isNow ? 'bg-indigo-500 text-white' : 'bg-black/10 dark:bg-white/10 text-gray-400 dark:text-white/30',
              ].join(' ')}>
                {isDone ? <CheckCircle className="w-4 h-4" /> : n}
              </div>
              <span className={[
                'text-xs font-medium text-center mt-1 leading-tight',
                isNow ? 'text-white' : isDone ? 'text-green-700 dark:text-green-400' : 'text-gray-400 dark:text-white/30',
              ].join(' ')}>
                {label}
              </span>
            </div>

            {/* Connector line (not after last item) */}
            {i < labels.length - 1 && (
              <div className={[
                'flex-1 h-0.5 mt-4 rounded transition-colors mx-1',
                current > n ? 'bg-green-500' : 'bg-black/10 dark:bg-white/10',
              ].join(' ')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
          <Server className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
        </div>
      </div>
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">HomeNas OS v3</h2>
        <p className="text-gray-500 dark:text-white/50 leading-relaxed">
          Bienvenido a tu sistema operativo NAS personal. Vamos a configurar
          las opciones básicas para que puedas empezar a usarlo.
        </p>
      </div>
      <button onClick={onNext} className="w-full py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-gray-900 dark:text-white font-semibold transition-colors">
        Empezar
      </button>
    </div>
  )
}

// ── Step 2: Account ───────────────────────────────────────────────────────────

function StepAccount({ onNext }: { onNext: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const changeAccount = useSetupAccount()
  const loginStore = useAuthStore((s) => s.login)

  const handleSubmit = async () => {
    setClientError(null)
    if (username.length < 5)          { setClientError('El usuario debe tener al menos 5 caracteres'); return }
    if (password.length < 8)          { setClientError('La contraseña debe tener al menos 8 caracteres'); return }
    if (!/[A-Z]/.test(password))      { setClientError('La contraseña debe incluir al menos una letra mayúscula'); return }
    if (!/[0-9]/.test(password))      { setClientError('La contraseña debe incluir al menos un número'); return }
    if (password !== confirm)         { setClientError('Las contraseñas no coinciden'); return }
    try {
      const result = await changeAccount.mutateAsync({ username, newPassword: password, confirmPassword: confirm })
      // Update stored username so sidebar shows the new one
      const current = useAuthStore.getState()
      if (current.user && current.sessionId && current.csrfToken) {
        loginStore({ sessionId: current.sessionId, csrfToken: current.csrfToken, user: { ...current.user, username: result.username } })
      }
      onNext()
    } catch (err) {
      setClientError(err instanceof Error ? err.message : 'Error al guardar la cuenta')
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
            <User className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Crea tu cuenta</h2>
        <p className="text-sm text-gray-500 dark:text-white/50">Elige un usuario y contraseña para acceder al dashboard.</p>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Usuario <span className="text-gray-400 dark:text-white/30">(mín. 5 caracteres)</span></label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)}
            placeholder="usuario" autoComplete="username"
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Contraseña <span className="text-gray-400 dark:text-white/30">(mín. 8 car., mayúscula y número)</span></label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••" autoComplete="new-password"
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Confirmar contraseña</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Repite la contraseña" autoComplete="new-password"
            onKeyDown={e => { if (e.key === 'Enter') void handleSubmit() }}
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40" />
        </div>
      </div>
      {clientError && <p className="text-xs text-red-600 dark:text-red-400 text-center">{clientError}</p>}
      <button onClick={() => void handleSubmit()}
        disabled={!username || !password || !confirm || changeAccount.isPending}
        className="w-full py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white font-semibold transition-colors flex items-center justify-center gap-2">
        {changeAccount.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {changeAccount.isPending ? 'Guardando...' : 'Crear cuenta y continuar'}
      </button>
    </div>
  )
}

// ── Step 3: Network ───────────────────────────────────────────────────────────

function StepNetwork({ onNext }: { onNext: () => void }) {
  const { data, isLoading } = useSetupNetwork()
  const configureNetwork = useConfigureNetwork()

  const interfaces = data?.interfaces ?? []
  const primary = interfaces[0]

  const [selectedIface, setSelectedIface] = useState<string>('')
  const [mode, setMode] = useState<'dhcp' | 'static'>('dhcp')
  const [ip, setIp] = useState('')
  const [prefix, setPrefix] = useState('24')
  const [gateway, setGateway] = useState('')
  const [dns, setDns] = useState('8.8.8.8')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [userEdited, setUserEdited] = useState(false)

  const activeIface = selectedIface || primary?.name || ''
  const activeIfaceData = interfaces.find(i => i.name === activeIface) ?? primary

  // When an interface is selected, pre-fill its current IP into the static fields
  // and detect if it's already configured (has an IP). Depends on
  // activeIfaceData (the source of truth), not on `data` directly.
  useEffect(() => {
    if (!activeIfaceData) return
    if (activeIfaceData.ip) {
      setIp(activeIfaceData.ip)
      // Guess gateway: same subnet, last octet .1
      const parts = activeIfaceData.ip.split('.')
      if (parts.length === 4) setGateway(`${parts[0]}.${parts[1]}.${parts[2]}.1`)
    }
    setMode(activeIfaceData.isDhcp ? 'dhcp' : 'static')
    setUserEdited(false)
  }, [activeIfaceData])

  // If the interface already has an IP and the user hasn't changed anything, allow skipping save
  const canContinueDirectly = (!!activeIfaceData?.ip && !userEdited) || saved

  const handleSave = async () => {
    setError(null)
    if (!activeIface) { setError('No hay interfaz de red disponible'); return }
    try {
      const payload: Parameters<typeof configureNetwork.mutateAsync>[0] = {
        interface: activeIface, mode,
        ...(mode === 'static' ? { ip, prefix: parseInt(prefix, 10), gateway, dns } : {}),
      }
      await configureNetwork.mutateAsync(payload)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al configurar red')
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
        <p className="text-sm text-gray-500 dark:text-white/40">Detectando interfaces de red...</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <Wifi className="w-7 h-7 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 text-center">Configuración de red</h2>
        <p className="text-sm text-gray-500 dark:text-white/50 text-center">Elige cómo obtiene la IP tu NAS.</p>
      </div>

      {/* Interface selector */}
      {interfaces.length > 1 && (
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Interfaz</label>
          <select value={activeIface} onChange={e => setSelectedIface(e.target.value)}
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500">
            {interfaces.map(i => (
              <option key={i.name} value={i.name} className="bg-gray-900">
                {i.name} {i.ip ? `— ${i.ip}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Current IP display */}
      {primary?.ip && (
        <div className="p-3 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-white/50">IP actual ({activeIface || primary.name})</span>
          <span className="text-sm font-mono text-gray-900 dark:text-white">{
            interfaces.find(i => i.name === activeIface)?.ip ?? primary.ip
          }</span>
        </div>
      )}

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-2">
        {(['dhcp', 'static'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setUserEdited(true) }}
            className={[
              'py-3 rounded-xl border text-sm font-semibold transition-all',
              mode === m ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70',
            ].join(' ')}>
            {m === 'dhcp' ? 'DHCP (automático)' : 'IP fija'}
          </button>
        ))}
      </div>

      {/* Static fields */}
      {mode === 'static' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Dirección IP</label>
              <input type="text" value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.10"
                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Prefijo</label>
              <input type="number" value={prefix} onChange={e => setPrefix(e.target.value)} min="1" max="32" placeholder="24"
                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">Puerta de enlace</label>
            <input type="text" value={gateway} onChange={e => setGateway(e.target.value)} placeholder="192.168.1.1"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-white/50 mb-1.5">DNS primario</label>
            <input type="text" value={dns} onChange={e => setDns(e.target.value)} placeholder="8.8.8.8"
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 font-mono" />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>}

      {saved && (
        <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm justify-center">
          <CheckCircle className="w-4 h-4" /> Configuración de red guardada
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={canContinueDirectly ? onNext : () => void handleSave()}
          disabled={configureNetwork.isPending}
          className="flex-1 py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white font-semibold transition-colors flex items-center justify-center gap-2">
          {configureNetwork.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {configureNetwork.isPending ? 'Aplicando...' : canContinueDirectly ? 'Continuar' : 'Guardar y continuar'}
        </button>
        <button onClick={onNext} className="px-4 py-3 rounded-xl bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:bg-white/15 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white text-sm font-medium transition-colors">
          Saltar
        </button>
      </div>
    </div>
  )
}

// ── Step 4: Storage ───────────────────────────────────────────────────────────

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { Disk } from '@homenas/shared'

type DiskRole = 'none' | 'data' | 'parity' | 'cache'
type PoolType = 'single' | 'mergerfs' | 'snapraid'
type FsType = 'ext4' | 'xfs'

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(0)} GB`
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}

const DISK_TYPE_TAG: Record<string, { label: string; className: string }> = {
  nvme:  { label: 'NVMe',  className: 'bg-purple-500/20 text-purple-700 dark:text-purple-300' },
  ssd:   { label: 'SSD',   className: 'bg-blue-500/20 text-blue-700 dark:text-blue-300' },
  hdd:   { label: 'HDD',   className: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' },
  usb:   { label: 'USB',   className: 'bg-orange-500/20 text-orange-300' },
  other: { label: 'Disco', className: 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/50' },
}

function StepStorage({ onNext }: { onNext: () => void }) {
  const configurePool = useConfigurePool()
  const { data: disksData, isLoading } = useQuery<Disk[]>({
    queryKey: ['storage', 'disks'],
    queryFn: () => apiFetch<Disk[]>('/storage/disks'),
    staleTime: 30_000,
  })

  const [roles, setRoles] = useState<Record<string, DiskRole>>({})
  const [poolType, setPoolType] = useState<PoolType>('mergerfs')
  const [fsType, setFsType] = useState<FsType>('ext4')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const disks = disksData ?? []
  const selectedDisks = disks.filter(d => roles[d.device] && roles[d.device] !== 'none')
  const dataCount   = selectedDisks.filter(d => roles[d.device] === 'data').length
  const parityCount = selectedDisks.filter(d => roles[d.device] === 'parity').length

  const canConfigure = (() => {
    if (dataCount === 0) return false
    if (poolType === 'snapraid' && parityCount === 0) return false
    return confirmed
  })()

  const handleConfigure = async () => {
    setError(null)
    try {
      await configurePool.mutateAsync({
        disks: selectedDisks.map(d => ({ device: d.device, role: roles[d.device] as 'data' | 'parity' | 'cache' })),
        fsType,
        poolType,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al configurar almacenamiento')
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
        <p className="text-sm text-gray-500 dark:text-white/40">Detectando discos...</p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center">
            <CheckCircle className="w-7 h-7 text-green-700 dark:text-green-400" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Almacenamiento configurado</h2>
        <p className="text-sm text-gray-500 dark:text-white/50">Los discos han sido formateados y montados en <span className="font-mono text-gray-700 dark:text-white/70">/mnt/pool</span></p>
        <button onClick={onNext} className="w-full py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-gray-900 dark:text-white font-semibold transition-colors">
          Continuar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <HardDrive className="w-7 h-7 text-purple-600 dark:text-purple-400" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 text-center">Almacenamiento</h2>
        <p className="text-sm text-gray-500 dark:text-white/50 text-center">Selecciona los discos y cómo organizarlos.</p>
      </div>

      {/* Disk list */}
      {disks.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-white/40 text-center py-4">No se detectaron discos adicionales.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider">Discos disponibles</p>
          {disks.map(disk => {
            const role = roles[disk.device] ?? 'none'
            const isSystemDisk = disk.mountPoint === '/'
            const tag = DISK_TYPE_TAG[disk.diskType] ?? DISK_TYPE_TAG.other
            return (
              <div key={disk.device} className={[
                'p-3 rounded-xl border',
                isSystemDisk ? 'border-black/5 dark:border-white/5 bg-white/3 opacity-50' : 'border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5',
              ].join(' ')}>
                <div className="flex items-center gap-3">
                  <HardDrive className="w-4 h-4 text-gray-400 dark:text-white/30 shrink-0" />

                  {/* Fixed-width left column: device + type tag */}
                  <div className="w-36 shrink-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-mono text-gray-900 dark:text-white">{disk.device}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${tag.className}`}>{tag.label}</span>
                      {isSystemDisk && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-medium">Sistema</span>}
                    </div>
                  </div>

                  {/* Middle: size + model + smart */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-600 dark:text-white/60 font-medium">{formatBytes(disk.sizeBytes)}</div>
                    {disk.model && (
                      <div className="text-xs text-gray-400 dark:text-white/30 truncate">{disk.model}</div>
                    )}
                    {disk.smart && (
                      <div className={`text-xs ${disk.smart.healthy ? 'text-green-700 dark:text-green-400/70' : 'text-red-600 dark:text-red-400'}`}>
                        SMART: {disk.smart.healthy ? 'OK' : 'Advertencia'}
                        {disk.smart.temperature != null ? ` · ${disk.smart.temperature}°C` : ''}
                      </div>
                    )}
                  </div>

                  {/* Role selector */}
                  {!isSystemDisk && (
                    <select value={role} onChange={e => setRoles(r => ({ ...r, [disk.device]: e.target.value as DiskRole }))}
                      className="bg-gray-100 dark:bg-gray-800 border border-black/10 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 shrink-0">
                      <option value="none">No usar</option>
                      <option value="data">Datos</option>
                      <option value="parity">Paridad</option>
                      <option value="cache">Caché</option>
                    </select>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pool type */}
      {selectedDisks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider">Tipo de pool</p>
          {([
            { value: 'single',   label: 'Disco único',  desc: 'Un solo disco montado directamente en /mnt/pool' },
            { value: 'mergerfs', label: 'MergerFS',     desc: 'Combina varios discos en un único directorio sin redundancia' },
            { value: 'snapraid', label: 'SnapRAID',     desc: 'MergerFS + paridad SnapRAID para recuperación ante fallos' },
          ] as { value: PoolType; label: string; desc: string }[]).map(opt => (
            <button key={opt.value} onClick={() => setPoolType(opt.value)}
              className={[
                'w-full text-left p-3 rounded-xl border transition-all',
                poolType === opt.value ? 'border-indigo-500 bg-indigo-500/10' : 'border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:border-white/20',
              ].join(' ')}>
              <div className="font-semibold text-sm text-gray-900 dark:text-white">{opt.label}</div>
              <div className="text-xs text-gray-500 dark:text-white/40 mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      )}

      {/* Filesystem */}
      {selectedDisks.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider mb-2">Sistema de ficheros</p>
          <div className="grid grid-cols-2 gap-2">
            {(['ext4', 'xfs'] as FsType[]).map(f => (
              <button key={f} onClick={() => setFsType(f)}
                className={[
                  'py-2.5 rounded-xl border text-sm font-semibold font-mono transition-all',
                  fsType === f ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/50 hover:text-gray-700 dark:text-white/70',
                ].join(' ')}>
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Validation warnings */}
      {poolType === 'snapraid' && parityCount === 0 && dataCount > 0 && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400 text-center">SnapRAID requiere al menos un disco de paridad</p>
      )}

      {/* Confirmation */}
      {selectedDisks.length > 0 && (
        <label className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 shrink-0 accent-red-500" />
          <span className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
            Entiendo que <strong>los discos seleccionados serán formateados</strong> y todos los datos existentes se perderán. Esta operación no puede deshacerse.
          </span>
        </label>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>}

      <div className="flex gap-2">
        {selectedDisks.length > 0 && (
          <button onClick={() => void handleConfigure()} disabled={!canConfigure || configurePool.isPending}
            className="flex-1 py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white font-semibold transition-colors flex items-center justify-center gap-2">
            {configurePool.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {configurePool.isPending ? 'Configurando...' : 'Configurar almacenamiento'}
          </button>
        )}
        <button onClick={onNext}
          className={['py-3 rounded-xl bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:bg-white/15 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white text-sm font-medium transition-colors', selectedDisks.length > 0 ? 'px-4' : 'w-full px-6'].join(' ')}>
          {selectedDisks.length > 0 ? 'Saltar' : 'Configurar después'}
        </button>
      </div>
    </div>
  )
}

// ── Step 5: Done ──────────────────────────────────────────────────────────────

function StepDone({ onFinish, isLoading }: { onFinish: () => void; isLoading: boolean }) {
  return (
    <div className="text-center space-y-6">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-700 dark:text-green-400" />
        </div>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">¡Todo listo!</h2>
        <p className="text-gray-500 dark:text-white/50">Tu HomeNas OS está funcionando correctamente.</p>
      </div>
      <button onClick={onFinish} disabled={isLoading}
        className="w-full py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-gray-900 dark:text-white font-semibold transition-colors flex items-center justify-center gap-2">
        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {isLoading ? 'Cargando...' : 'Ir al dashboard'}
      </button>
    </div>
  )
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export function SetupWizard() {
  const [step, setStep] = useState<Step>(1)
  const [autoLogging, setAutoLogging] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const completeSetup = useCompleteSetup()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const loginStore      = useAuthStore((s) => s.login)

  // Auto-login with admin/homenas1 so the user never sees the login screen.
  // Uses an AbortController so an unmount mid-request cancels in-flight work,
  // and a `cancelled` flag so we never call setState/navigate after unmount.
  // `setAutoLogging(false)` runs in `finally` so the spinner doesn't get stuck
  // when the request errors out.
  useEffect(() => {
    if (isAuthenticated) return
    const ctrl = new AbortController()
    let cancelled = false
    setAutoLogging(true)
    setupApi.autologin({ signal: ctrl.signal })
      .then((result) => { if (!cancelled) loginStore(result) })
      .catch((err) => {
        if (cancelled || ctrl.signal.aborted) return
        // Log so devs notice when autologin is misconfigured server-side
        if (err instanceof Error && err.name !== 'AbortError') {
          // eslint-disable-next-line no-console
          console.warn('Setup autologin failed, redirecting to /login', err)
        }
        navigate('/login', { replace: true })
      })
      .finally(() => { if (!cancelled) setAutoLogging(false) })
    return () => { cancelled = true; ctrl.abort() }
  }, [isAuthenticated, loginStore, navigate])

  if (autoLogging || !isAuthenticated) return <PageSpinner />

  const handleFinish = async () => {
    try { await completeSetup.mutateAsync() } catch { /* non-fatal */ }
    // Force cache update synchronously before navigating so SetupGuard
    // doesn't read stale complete:false and redirect back to /setup
    queryClient.setQueryData(['setup', 'status'], { complete: true })
    navigate('/')
  }

  const LABELS = ['Bienvenido', 'Cuenta', 'Red', 'Almacenamiento', 'Listo']

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <StepIndicators labels={LABELS} current={step} />

        {/* Card */}
        <div className="bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 rounded-2xl p-4 sm:p-8">
          {step === 1 && <StepWelcome onNext={() => setStep(2)} />}
          {step === 2 && <StepAccount onNext={() => setStep(3)} />}
          {step === 3 && <StepNetwork onNext={() => setStep(4)} />}
          {step === 4 && <StepStorage onNext={() => setStep(5)} />}
          {step === 5 && <StepDone onFinish={handleFinish} isLoading={completeSetup.isPending} />}
        </div>
      </div>
    </div>
  )
}
