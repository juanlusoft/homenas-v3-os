import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Shield, Plus, Trash2, QrCode, Play, Square, RotateCw, Download, Settings } from 'lucide-react'
import {
  useWireguardStatus,
  useRemoveWireguardPeer,
  useInstallWireguard,
  useInitWireguard,
  useStartWireguard,
  useStopWireguard,
  useRestartWireguard,
  useGetPeerConfig,
} from '../../hooks/useNetwork'
import { formatBytes } from '../../lib/utils'
import { AddPeerModal } from './AddPeerModal'
import type { WireguardPeer, WireguardInitInput } from '@homenas/shared'
import { useT } from '../../i18n/useT'

function formatRelativeTime(timestamp: number | null): string {
  if (timestamp === null) return 'Never'
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ─── PeerQrModal ──────────────────────────────────────────────────────────────

interface PeerQrModalProps {
  publicKey: string
  name: string
  onClose: () => void
}

function PeerQrModal({ publicKey, name, onClose }: PeerQrModalProps) {
  const getPeerConfig = useGetPeerConfig()
  const [loaded, setLoaded] = useState(false)
  const t = useT()

  if (!loaded) {
    getPeerConfig.mutate(publicKey, {
      onSuccess: () => setLoaded(true),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-gray-900 dark:text-white font-semibold">Peer: {name}</h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 transition-colors text-sm"
          >
            {t.common.close}
          </button>
        </div>

        {getPeerConfig.isPending && (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {getPeerConfig.error && (
          <p className="text-sm text-red-600 dark:text-red-400">{getPeerConfig.error.message}</p>
        )}

        {getPeerConfig.data && (
          <>
            {getPeerConfig.data.qrCode ? (
              <div className="flex justify-center bg-white rounded-lg p-3">
                <img
                  src={`data:image/png;base64,${getPeerConfig.data.qrCode}`}
                  alt="WireGuard peer QR code"
                  className="w-48 h-48"
                />
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-white/40 text-center">qrencode not installed on server</p>
            )}
            <div>
              <p className="text-xs text-gray-500 dark:text-white/40 mb-1">{t.network.publicKey}</p>
              <code className="text-xs font-mono text-gray-600 dark:text-white/60 break-all">{publicKey}</code>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── PeerRow ──────────────────────────────────────────────────────────────────

interface PeerRowProps {
  peer: WireguardPeer
  onRemove: (publicKey: string) => void
  isRemoving: boolean
}

function PeerRow({ peer, onRemove, isRemoving }: PeerRowProps) {
  const [showQrModal, setShowQrModal] = useState(false)
  const t = useT()

  return (
    <>
      <tr className="border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:bg-white/5 transition-colors">
        <td className="px-4 py-3">
          <span className="text-sm text-white/80">{peer.name}</span>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs font-mono text-gray-500 dark:text-white/50 truncate w-20 block">
            {peer.publicKey.slice(0, 16)}…
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs font-mono text-indigo-700 dark:text-indigo-300">{peer.allowedIPs}</span>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-gray-500 dark:text-white/50">{formatRelativeTime(peer.lastHandshake)}</span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-white/50 tabular-nums">
            <span>{formatBytes(peer.transferRx)}</span>
            <span className="text-gray-400 dark:text-white/20">/</span>
            <span>{formatBytes(peer.transferTx)}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQrModal(true)}
              className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
              title={t.network.showQr}
            >
              <QrCode className="w-4 h-4" />
            </button>
            <button
              onClick={() => onRemove(peer.publicKey)}
              disabled={isRemoving}
              className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title={t.network.removePeer}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>

      {showQrModal && (
        <PeerQrModal
          publicKey={peer.publicKey}
          name={peer.name}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </>
  )
}

// ─── InitForm ─────────────────────────────────────────────────────────────────

interface InitFormProps {
  onCancel: () => void
}

function InitForm({ onCancel }: InitFormProps) {
  const initWg = useInitWireguard()
  const { register, handleSubmit, formState: { errors } } = useForm<WireguardInitInput>({
    defaultValues: { port: 51820, dns: '1.1.1.1' },
  })
  const t = useT()

  const onSubmit = async (data: WireguardInitInput) => {
    try {
      await initWg.mutateAsync(data)
    } catch {
      // error shown below
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
      <p className="text-sm text-gray-600 dark:text-white/60">
        {t.network.wireguardNotConfigured}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-white/50 mb-1">{t.network.listenPort}</label>
          <input
            type="number"
            {...register('port', { required: true, min: 1, max: 65535, valueAsNumber: true })}
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-violet-500"
          />
          {errors.port && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Valid port required</p>}
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-white/50 mb-1">{t.network.dnsServer}</label>
          <input
            {...register('dns', { required: true })}
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-white/30 focus:outline-none focus:border-violet-500"
          />
          {errors.dns && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">DNS is required</p>}
        </div>
      </div>

      {initWg.error && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {initWg.error.message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-black/10 dark:bg-white/10 text-sm transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          type="submit"
          disabled={initWg.isPending}
          className="flex-1 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-gray-900 dark:text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {initWg.isPending ? t.common.applying : t.network.initServer}
        </button>
      </div>
    </form>
  )
}

// ─── WireguardCard ────────────────────────────────────────────────────────────

export function WireguardCard() {
  const { data: status, isLoading, error } = useWireguardStatus()
  const removePeer = useRemoveWireguardPeer()
  const installWg = useInstallWireguard()
  const startWg = useStartWireguard()
  const stopWg = useStopWireguard()
  const restartWg = useRestartWireguard()
  const t = useT()

  const [showAddModal, setShowAddModal] = useState(false)
  const [showInitForm, setShowInitForm] = useState(false)

  const handleRemove = (publicKey: string) => {
    if (confirm(t.network.removePeer)) {
      removePeer.mutate(publicKey)
    }
  }

  const handleInstall = () => {
    installWg.mutate()
  }

  // Determine whether wg0.conf exists (server IP present means configured)
  const isConfigured = Boolean(status?.installed && (status.serverIp || status.publicKey))

  return (
    <>
      <div className="bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 rounded-xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/10 dark:border-white/10 flex items-center gap-3">
          <Shield className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">{t.network.wireguardTitle}</h2>

          {status && (
            <span className={`ml-1 text-xs px-2 py-0.5 rounded font-medium ${
              status.active
                ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                : status.installed
                  ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                  : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/40'
            }`}>
              {status.active ? t.common.active : status.installed ? t.homestore.installed : t.syncthing.notInstalled}
            </span>
          )}

          {status?.installed && status.peers.length > 0 && (
            <span className="text-xs text-gray-500 dark:text-white/40">
              {status.peers.length} peer{status.peers.length !== 1 ? 's' : ''}
            </span>
          )}

          {/* Control buttons — only when active */}
          {status?.active && (
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => restartWg.mutate()}
                disabled={restartWg.isPending}
                className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-50"
                title={t.common.restart}
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => stopWg.mutate()}
                disabled={stopWg.isPending}
                className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                title={t.common.stop}
              >
                <Square className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-gray-900 dark:text-white text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.network.addPeer}
              </button>
            </div>
          )}

          {/* Start button — installed + configured but not active */}
          {status?.installed && isConfigured && !status.active && (
            <button
              onClick={() => startWg.mutate()}
              disabled={startWg.isPending}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-gray-900 dark:text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {startWg.isPending ? t.common.applying : t.common.start}
            </button>
          )}

          {/* Init button — installed but not configured */}
          {status?.installed && !isConfigured && !showInitForm && (
            <button
              onClick={() => setShowInitForm(true)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/70 hover:bg-violet-600 text-gray-900 dark:text-white text-xs font-medium transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              {t.network.initServer}
            </button>
          )}
        </div>

        <div className="px-6 py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-4 bg-black/10 dark:bg-white/10 rounded animate-pulse" style={{ width: `${40 + i * 20}%` }} />
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{t.network.failedToLoad}</p>
          )}

          {/* NOT INSTALLED */}
          {status && !status.installed && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-white/40">{t.network.wireguardNotInstalled}</p>
              {installWg.data?.output && (
                <pre className="bg-black/40 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-green-700 dark:text-green-400 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {installWg.data.output}
                </pre>
              )}
              {installWg.error && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                  {installWg.error.message}
                </p>
              )}
              <button
                onClick={handleInstall}
                disabled={installWg.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-gray-900 dark:text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {installWg.isPending ? t.common.applying : t.network.installWireguard}
              </button>
            </div>
          )}

          {/* INSTALLED BUT NOT CONFIGURED */}
          {status?.installed && !isConfigured && (
            <>
              {showInitForm ? (
                <InitForm onCancel={() => setShowInitForm(false)} />
              ) : (
                <p className="text-sm text-gray-500 dark:text-white/40">
                  {t.network.wireguardNotConfigured}
                </p>
              )}
            </>
          )}

          {/* INSTALLED AND CONFIGURED */}
          {status?.installed && isConfigured && (
            <div className="space-y-4">
              {/* Interface info */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-500 dark:text-white/40 mb-0.5">Interface</p>
                  <p className="text-sm font-mono text-white/80">{status.interface}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-white/40 mb-0.5">{t.network.serverIp}</p>
                  <p className="text-sm font-mono text-white/80">{status.serverIp ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-white/40 mb-0.5">{t.network.listenPort}</p>
                  <p className="text-sm font-mono text-white/80">{status.listenPort ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-white/40 mb-0.5">{t.network.publicKey}</p>
                  <p className="text-xs font-mono text-gray-600 dark:text-white/60 truncate">
                    {status.publicKey ? `${status.publicKey.slice(0, 20)}…` : '—'}
                  </p>
                </div>
              </div>

              {/* Peers table */}
              {status.peers.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-white/30">{t.network.noPeers}</p>
              ) : (
                <div className="overflow-x-auto -mx-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-black/10 dark:border-white/10 text-gray-500 dark:text-white/40 text-xs uppercase tracking-wider">
                        <th className="px-4 py-2 text-left font-medium">{t.common.name}</th>
                        <th className="px-4 py-2 text-left font-medium">{t.network.publicKey}</th>
                        <th className="px-4 py-2 text-left font-medium">{t.network.allowedIps}</th>
                        <th className="px-4 py-2 text-left font-medium">{t.network.lastHandshake}</th>
                        <th className="px-4 py-2 text-left font-medium">{t.network.transferRxTx}</th>
                        <th className="px-4 py-2 text-left font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.peers.map((peer) => (
                        <PeerRow
                          key={peer.publicKey}
                          peer={peer}
                          onRemove={handleRemove}
                          isRemoving={removePeer.isPending}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showAddModal && <AddPeerModal onClose={() => setShowAddModal(false)} />}
    </>
  )
}
