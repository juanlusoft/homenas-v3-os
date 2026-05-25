import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Folder,
  File,
  Image,
  Film,
  Music,
  FileText,
  Archive,
  Code,
  Grid3X3,
  List,
  Upload,
  FolderPlus,
  Download,
  Trash2,
  Pencil,
  Move,
  Copy,
  Search,
  ChevronRight,
  Home,
  RefreshCw,
  X,
  Check,
  AlertTriangle,
  FolderOpen,
  HardDrive,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  useDirectoryListing,
  useFileSearch,
  useFileLocations,
  useMkdir,
  useDeleteItem,
  useRenameItem,
  useMoveItem,
} from '../../hooks/useFiles'
import { filesApi } from '../../api/files'
import type { FileEntry } from '../../api/files'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '../../i18n/useT'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getFileIcon(entry: FileEntry): React.ReactNode {
  if (entry.type === 'dir') return <Folder className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />

  const name = entry.name.toLowerCase()
  const ext = name.split('.').pop() ?? ''

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff'].includes(ext))
    return <Image className="w-5 h-5 text-pink-600 dark:text-pink-400 shrink-0" />
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'].includes(ext))
    return <Film className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0" />
  if (['mp3', 'flac', 'aac', 'ogg', 'wav', 'm4a', 'opus'].includes(ext))
    return <Music className="w-5 h-5 text-green-700 dark:text-green-400 shrink-0" />
  if (['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z', 'zst'].includes(ext))
    return <Archive className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'sh', 'json', 'yaml', 'yml', 'toml', 'conf', 'cfg', 'ini'].includes(ext))
    return <Code className="w-5 h-5 text-cyan-600 dark:text-cyan-400 shrink-0" />
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'csv', 'log'].includes(ext))
    return <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />

  return <File className="w-5 h-5 text-gray-500 dark:text-white/40 shrink-0" />
}

function buildBreadcrumbs(path: string, roots: string[], homeLabel = 'Home'): Array<{ label: string; path: string }> {
  const crumbs: Array<{ label: string; path: string }> = []

  // Find which root this path starts with
  const root = roots.find((r) => path.startsWith(r)) ?? roots[0]

  crumbs.push({ label: homeLabel, path: root ?? '/' })

  const relative = path.slice(root?.length ?? 0)
  const parts = relative.split('/').filter(Boolean)

  let current = root ?? '/'
  for (const part of parts) {
    current = current.endsWith('/') ? `${current}${part}` : `${current}/${part}`
    crumbs.push({ label: part, path: current })
  }

  return crumbs
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

// ─── Modal components ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-xl w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 dark:border-white/10">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

function UploadZone({ currentPath, onDone }: { currentPath: string; onDone: () => void }) {
  const t = useT()
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    setProgress(0)
    try {
      await filesApi.upload(currentPath, Array.from(files), setProgress)
      onDone()
      setProgress(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.files.uploadFailed)
      setProgress(null)
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
        dragging ? 'border-indigo-400 bg-indigo-500/10' : 'border-black/10 dark:border-white/10 hover:border-white/20 bg-black/5 dark:bg-white/5',
      )}
    >
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
      <Upload className="w-8 h-8 text-gray-400 dark:text-white/30 mx-auto mb-2" />
      {progress !== null ? (
        <div>
          <div className="text-sm text-gray-600 dark:text-white/60 mb-2">{t.files.uploadingProgress(progress)}</div>
          <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1.5">
            <div className="bg-indigo-400 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-white/40">{t.files.dropHere}</p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
    </div>
  )
}

// ─── Directory tree ───────────────────────────────────────────────────────────

function TreeNode({ path, depth, currentPath, onNavigate, hideRoot = false }: {
  path: string
  depth: number
  currentPath: string
  onNavigate: (p: string) => void
  hideRoot?: boolean
}) {
  // Only auto-expand the root. With depth <= 1 we'd auto-fetch every direct
  // child of the root on mount, producing N+1 directory listings on stores
  // with many top-level folders. The user opens deeper levels with a click.
  const [expanded, setExpanded] = useState(depth === 0)
  const { data: entries } = useDirectoryListing(expanded ? path : null)

  const dirs = entries?.filter((e) => e.type === 'dir') ?? []
  const isActive = currentPath === path

  if (hideRoot) {
    // Render only children, not this node itself
    return expanded ? (
      <>
        {dirs.map((dir) => (
          <TreeNode
            key={joinPath(path, dir.name)}
            path={joinPath(path, dir.name)}
            depth={depth}
            currentPath={currentPath}
            onNavigate={onNavigate}
          />
        ))}
      </>
    ) : null
  }

  return (
    <div>
      <button
        onClick={() => {
          setExpanded(!expanded)
          onNavigate(path)
        }}
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-sm text-left transition-colors',
          isActive ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:bg-white/5',
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {dirs.length > 0 ? (
          <ChevronRight className={cn('w-3 h-3 shrink-0 transition-transform', expanded && 'rotate-90')} />
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}
        {isActive ? (
          <FolderOpen className="w-4 h-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
        ) : (
          <Folder className="w-4 h-4 shrink-0 text-gray-500 dark:text-white/40" />
        )}
        <span className="truncate">{path.split('/').filter(Boolean).pop() ?? path}</span>
      </button>

      {expanded && dirs.map((dir) => (
        <TreeNode
          key={joinPath(path, dir.name)}
          path={joinPath(path, dir.name)}
          depth={depth + 1}
          currentPath={currentPath}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number
  y: number
  entry: FileEntry
  path: string
}

function ContextMenu({ menu, onClose, onAction }: {
  menu: ContextMenuState
  onClose: () => void
  onAction: (action: string, entry: FileEntry, path: string) => void
}) {
  useEffect(() => {
    const handler = () => onClose()
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [onClose])

  const actions = [
    { id: 'download', label: 'Download', icon: Download, hide: menu.entry.type === 'dir' },
    { id: 'rename', label: 'Rename', icon: Pencil, hide: false },
    { id: 'move', label: 'Move', icon: Move, hide: false },
    { id: 'copy', label: 'Copy', icon: Copy, hide: false },
    { id: 'delete', label: 'Delete', icon: Trash2, hide: false, danger: true },
  ]

  return (
    <div
      className="fixed z-50 bg-gray-100 dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-xl shadow-2xl py-1 min-w-36"
      style={{ top: menu.y, left: menu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.filter((a) => !a.hide).map((action) => (
        <button
          key={action.id}
          onClick={() => { onAction(action.id, menu.entry, menu.path); onClose() }}
          className={cn(
            'flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors',
            action.danger
              ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10'
              : 'text-gray-700 dark:text-white/70 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:bg-white/5',
          )}
        >
          <action.icon className="w-4 h-4 shrink-0" />
          {action.label}
        </button>
      ))}
    </div>
  )
}

// ─── Main FilesView ───────────────────────────────────────────────────────────

export function FilesView() {
  const t = useT()
  const queryClient = useQueryClient()
  const { data: locations = [] } = useFileLocations()
  const rootPaths = locations.map((l) => l.path)

  const [currentPath, setCurrentPath] = useState<string>('/mnt/')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Once locations load, jump to the first one — but ONLY on the very first
  // mount. Re-running on currentPath change would steal navigation away from
  // the user every time they go back to /mnt/ manually.
  const initialJumpDone = useRef(false)
  useEffect(() => {
    if (initialJumpDone.current) return
    if (locations.length > 0 && currentPath === '/mnt/' && locations[0]) {
      initialJumpDone.current = true
      setCurrentPath(locations[0].path)
    }
  }, [locations, currentPath])

  // Modals
  const [showMkdir, setShowMkdir] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showRename, setShowRename] = useState<{ entry: FileEntry; path: string } | null>(null)
  const [showMove, setShowMove] = useState<{ entries: Array<{ entry: FileEntry; path: string }> } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Array<{ entry: FileEntry; path: string }> | null>(null)

  // Form state
  const [mkdirName, setMkdirName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [moveDest, setMoveDest] = useState('')

  const { data: entries, isLoading, isError, refetch } = useDirectoryListing(currentPath)
  const searchEnabled = searchQuery.length > 1
  const { data: searchResults } = useFileSearch(searchEnabled ? currentPath : null, searchQuery)

  const mkdir = useMkdir()
  const deleteItem = useDeleteItem()
  const renameItem = useRenameItem()
  const moveItem = useMoveItem()

  const navigate = useCallback((path: string) => {
    setCurrentPath(path)
    setSelected(new Set())
    setSearchQuery('')
  }, [])

  const breadcrumbs = buildBreadcrumbs(currentPath, rootPaths.length > 0 ? rootPaths : ['/mnt/'], t.files.home)

  const displayEntries: FileEntry[] = searchEnabled && searchResults
    ? searchResults.map((p) => ({
        name: p.split('/').pop() ?? p,
        type: 'file' as const,
        size: 0,
        modified: 0,
        permissions: '',
      }))
    : (entries ?? [])

  const toggleSelect = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleEntryClick = (entry: FileEntry) => {
    if (entry.type === 'dir') {
      navigate(joinPath(currentPath, entry.name))
    }
  }

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      entry,
      path: joinPath(currentPath, entry.name),
    })
  }

  const handleContextAction = (action: string, entry: FileEntry, path: string) => {
    switch (action) {
      case 'download': {
        // getDownloadUrl is async: it fetches the file using the session
        // header (no leak in URL) and returns a blob: URL. Revoke it after
        // the browser has had a chance to start the download.
        void filesApi
          .getDownloadUrl(path)
          .then((url) => {
            const a = document.createElement('a')
            a.href = url
            a.download = entry.name
            a.click()
            // Defer revoke so the click handler can pick up the URL first
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error('Download failed', err)
          })
        break
      }
      case 'rename':
        setRenameName(entry.name)
        setShowRename({ entry, path })
        break
      case 'move':
        setMoveDest(currentPath)
        setShowMove({ entries: [{ entry, path }] })
        break
      case 'delete':
        setConfirmDelete([{ entry, path }])
        break
    }
  }

  const handleBulkDelete = () => {
    const items = Array.from(selected).map((name) => ({
      entry: entries?.find((e) => e.name === name) ?? { name, type: 'file' as const, size: 0, modified: 0, permissions: '' },
      path: joinPath(currentPath, name),
    }))
    setConfirmDelete(items)
  }

  const handleBulkMove = () => {
    setMoveDest(currentPath)
    const items = Array.from(selected).map((name) => ({
      entry: entries?.find((e) => e.name === name) ?? { name, type: 'file' as const, size: 0, modified: 0, permissions: '' },
      path: joinPath(currentPath, name),
    }))
    setShowMove({ entries: items })
  }

  const execMkdir = () => {
    if (!mkdirName.trim()) return
    mkdir.mutate({ path: joinPath(currentPath, mkdirName.trim()) }, {
      onSuccess: () => {
        setShowMkdir(false)
        setMkdirName('')
        queryClient.invalidateQueries({ queryKey: ['files', 'list', currentPath] })
      },
    })
  }

  const execRename = () => {
    if (!showRename || !renameName.trim()) return
    const parentPath = showRename.path.split('/').slice(0, -1).join('/')
    renameItem.mutate(
      { oldPath: showRename.path, newPath: joinPath(parentPath, renameName.trim()) },
      { onSuccess: () => setShowRename(null) }
    )
  }

  const execMove = async () => {
    if (!showMove || !moveDest.trim()) return
    for (const { entry, path } of showMove.entries) {
      await moveItem.mutateAsync({ source: path, destination: joinPath(moveDest.trim(), entry.name) })
    }
    setShowMove(null)
    setSelected(new Set())
  }

  const execDelete = async () => {
    if (!confirmDelete) return
    for (const { path } of confirmDelete) {
      await deleteItem.mutateAsync({ path })
    }
    setConfirmDelete(null)
    setSelected(new Set())
  }

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-80px)] overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
      {/* ── Sidebar tree ── */}
      <aside className={cn(
        'shrink-0 bg-gray-900/60 border-r border-black/5 dark:border-white/5 overflow-y-auto py-3 px-2',
        'w-full md:w-56',
        mobileSidebarOpen ? 'block' : 'hidden md:block',
      )}>
        <p className="text-xs text-gray-400 dark:text-white/30 uppercase tracking-wider px-2 mb-2">Locations</p>
        {locations.length === 0 ? (
          <div className="px-2 py-1.5 space-y-1.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-7 bg-black/5 dark:bg-white/5 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          locations.map((loc) => (
            <div key={loc.path}>
              <button
                onClick={() => navigate(loc.path)}
                className={cn(
                  'flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-sm text-left transition-colors mb-0.5',
                  currentPath === loc.path || currentPath.startsWith(loc.path)
                    ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:bg-white/5',
                )}
              >
                <HardDrive className="w-3.5 h-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                <span className="truncate capitalize">{loc.label}</span>
              </button>
              <TreeNode
                key={loc.path}
                path={loc.path}
                depth={1}
                currentPath={currentPath}
                onNavigate={navigate}
                hideRoot
              />
            </div>
          ))
        )}
      </aside>

      {/* ── Main panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-black/5 dark:border-white/5 shrink-0">
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setMobileSidebarOpen((v) => !v)}
            className="md:hidden p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:bg-white/5 transition-colors"
            title="Toggle locations"
          >
            <HardDrive className="w-4 h-4" />
          </button>
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm flex-1 min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="w-3 h-3 text-gray-400 dark:text-white/20 shrink-0" />}
                <button
                  onClick={() => navigate(crumb.path)}
                  className={cn(
                    'hover:text-gray-900 dark:hover:text-white transition-colors truncate',
                    // Active crumb needs both light + dark variants — previously
                    // only `text-white` was set which is unreadable in light mode.
                    i === breadcrumbs.length - 1
                      ? 'text-zinc-900 dark:text-white font-medium'
                      : 'text-gray-500 dark:text-white/40',
                  )}
                >
                  {i === 0 ? <Home className="w-3.5 h-3.5" /> : crumb.label}
                </button>
              </span>
            ))}
          </nav>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              className="pl-8 pr-3 py-1.5 text-xs bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:text-white/30 focus:outline-none focus:border-indigo-500 w-40"
            />
          </div>

          {/* Actions */}
          <button
            onClick={() => { setMkdirName(''); setShowMkdir(true) }}
            className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:bg-white/5 transition-colors"
            title={t.files.newFolderTitle}
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:bg-white/5 transition-colors"
            title={t.files.uploadTitle}
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            onClick={() => void refetch()}
            className="p-1.5 rounded-lg text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80 hover:bg-black/5 dark:bg-white/5 transition-colors"
            title={t.files.refreshTitle}
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border border-black/10 dark:border-white/10">
            <button
              onClick={() => setViewMode('list')}
              className={cn('p-1.5 transition-colors', viewMode === 'list' ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80')}
              title={t.files.listView}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={cn('p-1.5 transition-colors', viewMode === 'grid' ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80')}
              title={t.files.gridView}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-indigo-500/10 border-b border-indigo-500/20 text-sm text-indigo-700 dark:text-indigo-300 shrink-0">
            <Check className="w-4 h-4" />
            <span>{t.files.selected(selected.size)}</span>
            <button onClick={handleBulkMove} className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-white transition-colors">
              <Move className="w-3.5 h-3.5" /> {t.files.move}
            </button>
            <button onClick={handleBulkDelete} className="flex items-center gap-1 text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> {t.files.delete}
            </button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/80">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* File listing */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-black/5 dark:bg-white/5 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm p-4">
              <AlertTriangle className="w-4 h-4" />
              <span>Failed to load directory</span>
            </div>
          ) : displayEntries.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-white/30 text-sm">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              {searchEnabled ? 'No results found' : 'Empty directory'}
            </div>
          ) : viewMode === 'list' ? (
            /* List view */
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 dark:text-white/30 uppercase tracking-wider border-b border-black/5 dark:border-white/5">
                  <th className="text-left pb-2 pl-8">Name</th>
                  <th className="text-right pb-2 pr-4 hidden sm:table-cell">Size</th>
                  <th className="text-left pb-2 pl-4 hidden sm:table-cell">Modified</th>
                  <th className="text-left pb-2 pl-4 hidden lg:table-cell">Permissions</th>
                </tr>
              </thead>
              <tbody>
                {displayEntries.map((entry) => {
                  const isSelected = selected.has(entry.name)
                  return (
                    <tr
                      key={entry.name}
                      onDoubleClick={() => handleEntryClick(entry)}
                      onContextMenu={(e) => handleContextMenu(e, entry)}
                      className={cn(
                        'group border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:bg-white/5 cursor-default transition-colors',
                        isSelected && 'bg-indigo-500/10',
                      )}
                    >
                      <td className="py-2 pl-0">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            // toggleSelect is wired to onClick (so we get the
                            // shift/ctrl modifiers from the mouse event).
                            // onChange is here only to silence React's
                            // controlled-input warning — it intentionally does
                            // nothing. e.stopPropagation prevents the row's
                            // double-click handler from firing on toggle.
                            onClick={(e) => { e.stopPropagation(); toggleSelect(entry.name, e) }}
                            onChange={(e) => { e.stopPropagation() }}
                            className="w-3.5 h-3.5 accent-indigo-500 shrink-0"
                          />
                          {getFileIcon(entry)}
                          <span
                            className={cn(
                              'truncate max-w-xs',
                              entry.type === 'dir' ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-700 dark:text-white/80',
                            )}
                            onDoubleClick={() => handleEntryClick(entry)}
                          >
                            {entry.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-gray-500 dark:text-white/40 text-xs hidden sm:table-cell">
                        {entry.type === 'dir' ? '—' : formatSize(entry.size)}
                      </td>
                      <td className="py-2 pl-4 text-gray-500 dark:text-white/40 text-xs whitespace-nowrap hidden sm:table-cell">
                        {entry.modified ? formatDate(entry.modified) : '—'}
                      </td>
                      <td className="py-2 pl-4 font-mono text-gray-400 dark:text-white/30 text-xs hidden lg:table-cell">
                        {entry.permissions}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            /* Grid view */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {displayEntries.map((entry) => {
                const isSelected = selected.has(entry.name)
                return (
                  <div
                    key={entry.name}
                    onDoubleClick={() => handleEntryClick(entry)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                    onClick={(e) => toggleSelect(entry.name, e)}
                    className={cn(
                      'flex flex-col items-center gap-2 p-3 rounded-xl border cursor-default transition-colors text-center',
                      isSelected
                        ? 'border-indigo-500/40 bg-indigo-500/10'
                        : 'border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:bg-white/10 hover:border-black/10 dark:border-white/10',
                    )}
                  >
                    <div className="w-10 h-10 flex items-center justify-center">
                      {getFileIcon({ ...entry, type: entry.type })}
                    </div>
                    <p className="text-xs text-gray-700 dark:text-white/70 w-full truncate">{entry.name}</p>
                    {entry.type !== 'dir' && (
                      <p className="text-xs text-gray-400 dark:text-white/30">{formatSize(entry.size)}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />
      )}

      {/* ── Modals ── */}

      {/* New folder */}
      {showMkdir && (
        <Modal title="New Folder" onClose={() => setShowMkdir(false)}>
          <input
            type="text"
            value={mkdirName}
            onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && execMkdir()}
            placeholder="Folder name"
            autoFocus
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:text-white/30 focus:outline-none focus:border-indigo-500 mb-4"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowMkdir(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white">
              Cancel
            </button>
            <button
              onClick={execMkdir}
              disabled={!mkdirName.trim() || mkdir.isPending}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-gray-900 dark:text-white transition-colors"
            >
              Create
            </button>
          </div>
        </Modal>
      )}

      {/* Upload */}
      {showUpload && (
        <Modal title="Upload Files" onClose={() => setShowUpload(false)}>
          <UploadZone
            currentPath={currentPath}
            onDone={() => {
              setShowUpload(false)
              queryClient.invalidateQueries({ queryKey: ['files', 'list', currentPath] })
            }}
          />
        </Modal>
      )}

      {/* Rename */}
      {showRename && (
        <Modal title="Rename" onClose={() => setShowRename(null)}>
          <input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && execRename()}
            autoFocus
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 mb-4"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowRename(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white">
              Cancel
            </button>
            <button
              onClick={execRename}
              disabled={!renameName.trim() || renameItem.isPending}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-gray-900 dark:text-white transition-colors"
            >
              Rename
            </button>
          </div>
        </Modal>
      )}

      {/* Move */}
      {showMove && (
        <Modal title={`Move ${showMove.entries.length} item(s)`} onClose={() => setShowMove(null)}>
          <label className="text-xs text-gray-500 dark:text-white/40 uppercase tracking-wider block mb-1">Destination path</label>
          <input
            type="text"
            value={moveDest}
            onChange={(e) => setMoveDest(e.target.value)}
            autoFocus
            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white font-mono focus:outline-none focus:border-indigo-500 mb-4"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowMove(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white">
              Cancel
            </button>
            <button
              onClick={() => void execMove()}
              disabled={!moveDest.trim() || moveItem.isPending}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-gray-900 dark:text-white transition-colors"
            >
              Move
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <Modal title="Confirm Delete" onClose={() => setConfirmDelete(null)}>
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700 dark:text-white/70">
              Permanently delete <strong className="text-gray-900 dark:text-white">{confirmDelete.length === 1 ? confirmDelete[0]?.entry.name : `${confirmDelete.length} items`}</strong>?
              This cannot be undone.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white">
              Cancel
            </button>
            <button
              onClick={() => void execDelete()}
              disabled={deleteItem.isPending}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg text-gray-900 dark:text-white transition-colors"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
