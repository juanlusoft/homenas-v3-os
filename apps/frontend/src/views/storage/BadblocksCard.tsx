import { useState } from 'react'
import { Play, StopCircle, AlertTriangle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useBadblocksStatus, useStartBadblocks, useStopBadblocks } from '../../hooks/useStorage'
import { useT } from '../../i18n/useT'

export function BadblocksCard() {
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useBadblocksStatus()
  const startMutation = useStartBadblocks()
  const stopMutation = useStopBadblocks()
  const t = useT()

  const [showForm, setShowForm] = useState(false)
  const [device, setDevice] = useState('')
  const [writeMode, setWriteMode] = useState(false)
  const [deviceError, setDeviceError] = useState('')

  const running = status?.running ?? false

  function handleStop() {
    stopMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['storage', 'badblocks', 'status'] })
      },
    })
  }

  function handleStart() {
    setDeviceError('')
    if (!/^\/dev\/[a-z0-9]+$/.test(device)) {
      setDeviceError('Formato inválido. Usa /dev/sdX o /dev/nvmeX')
      return
    }
    startMutation.mutate({ device, writeMode }, {
      onSuccess: () => {
        setShowForm(false)
        setDevice('')
        setWriteMode(false)
      },
    })
  }

  return (
    <div className="bg-black/5 dark:bg-white/5 backdrop-blur border border-black/10 dark:border-white/10 rounded-xl shadow-lg p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
          <h2 className="font-semibold text-gray-900 dark:text-white">{t.storage.badblocks}</h2>
        </div>
        {status && (
          status.running
            ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                EJECUTANDO
              </span>
            )
            : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-black/10 dark:bg-white/10 text-gray-500 dark:text-white/50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
                {t.common.inactive.toUpperCase()}
              </span>
            )
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-4 bg-black/10 dark:bg-white/10 rounded animate-pulse" />
          ))}
        </div>
      )}

      {status && (
        <>
          {/* Current device */}
          {status.device && (
            <div className="bg-black/5 dark:bg-white/5 rounded-lg px-3 py-2 text-xs">
              <span className="text-gray-500 dark:text-white/40 mr-2">{t.storage.device}</span>
              <span className="font-mono text-indigo-700 dark:text-indigo-300">{status.device}</span>
            </div>
          )}

          {/* Progress bar */}
          {status.running && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500 dark:text-white/40">
                <span>Progreso</span>
                <span className="tabular-nums">{status.progress.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-500 rounded-full transition-all duration-500"
                  style={{ width: `${status.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="bg-black/5 dark:bg-white/5 rounded-lg px-3 py-2">
              <p className="text-gray-500 dark:text-white/40 mb-1">{t.storage.verifiedBlocks}</p>
              <p className="text-gray-700 dark:text-white/70 tabular-nums font-mono">{status.blocksChecked.toLocaleString()}</p>
            </div>
            <div className={`rounded-lg px-3 py-2 ${status.badBlocks > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-black/5 dark:bg-white/5'}`}>
              <p className="text-gray-500 dark:text-white/40 mb-1">{t.storage.badBlocks}</p>
              <p className={`tabular-nums font-mono font-semibold ${status.badBlocks > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-white/70'}`}>
                {status.badBlocks.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Status message */}
          {status.status && (
            <p className="text-xs text-gray-500 dark:text-white/50 font-mono bg-black/5 dark:bg-white/5 rounded px-3 py-2 truncate">
              {status.status}
            </p>
          )}

          {/* Error */}
          {status.error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
              {status.error}
            </p>
          )}

          {/* Stop error */}
          {stopMutation.isError && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Error al detener: {(stopMutation.error as Error)?.message ?? 'Error desconocido'}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {running ? (
              <button
                onClick={handleStop}
                disabled={stopMutation.isPending}
                className="flex items-center gap-1.5 text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-700 dark:text-red-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <StopCircle className="w-3.5 h-3.5" />
                {stopMutation.isPending ? 'Deteniendo...' : 'Detener'}
              </button>
            ) : (
              <button
                onClick={() => setShowForm(!showForm)}
                className="flex items-center gap-1.5 text-xs font-medium bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-700 dark:text-yellow-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Play className="w-3 h-3" />
                Iniciar escaneo
              </button>
            )}
          </div>

          {/* Start form */}
          {showForm && !running && (
            <div className="border border-black/10 dark:border-white/10 rounded-lg p-4 space-y-3 bg-black/5 dark:bg-white/5">
              <p className="text-xs font-medium text-gray-700 dark:text-white/70">Configurar escaneo de bloques</p>

              <div>
                <label className="block text-xs text-gray-500 dark:text-white/40 mb-1">Dispositivo</label>
                <input
                  type="text"
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  placeholder="/dev/sda"
                  className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded px-3 py-1.5 text-xs font-mono text-gray-900 dark:text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50"
                />
                {deviceError && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">{deviceError}</p>
                )}
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={writeMode}
                  onChange={(e) => setWriteMode(e.target.checked)}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-xs text-gray-600 dark:text-white/60">Modo escritura (-w)</span>
                  {writeMode && (
                    <div className="flex items-start gap-1.5 mt-1.5 text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        DESTRUCTIVO: el modo escritura borra todos los datos del disco.
                        Solo usar en discos vacíos.
                      </span>
                    </div>
                  )}
                </div>
              </label>

              <div className="flex gap-2">
                <button
                  onClick={handleStart}
                  disabled={startMutation.isPending || !device}
                  className="flex items-center gap-1.5 text-xs font-medium bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-700 dark:text-yellow-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Play className="w-3 h-3" />
                  {startMutation.isPending ? 'Iniciando...' : 'Iniciar'}
                </button>
                <button
                  onClick={() => { setShowForm(false); setDeviceError('') }}
                  className="text-xs text-gray-500 dark:text-white/40 hover:text-gray-600 dark:text-white/60 px-3 py-1.5 rounded-lg hover:bg-black/5 dark:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
