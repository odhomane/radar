import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, File, Folder, FolderPlus, Loader2, PencilLine, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { clsx } from 'clsx'
import {
  deletePodPath,
  downloadPodArchive,
  downloadPodFile,
  getPodFilesystem,
  isForbiddenError,
  mkdirPodPath,
  renamePodPath,
  savePodFile,
  searchPodFilesystem,
  uploadPodFile,
  type PodFilesystemEntry,
} from '../../api/client'

interface PodFilesystemModalProps {
  open: boolean
  onClose: () => void
  namespace: string
  podName: string
  containerName: string
}

export function PodFilesystemModal({
  open,
  onClose,
  namespace,
  podName,
  containerName,
}: PodFilesystemModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<PodFilesystemEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionPath, setActionPath] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PodFilesystemEntry[]>([])
  const [editingEntry, setEditingEntry] = useState<PodFilesystemEntry | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorSaving, setEditorSaving] = useState(false)

  const loadPath = async (targetPath: string) => {
    if (!open) return
    setLoading(true)
    setError(null)
    try {
      const data = await getPodFilesystem(namespace, podName, containerName, targetPath)
      setCurrentPath(data.currentPath || targetPath)
      setEntries(data.entries || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      setCurrentPath('/')
      setEntries([])
      setError(null)
      setActionPath(null)
      setSearchQuery('')
      setSearchResults([])
      setSearching(false)
      setEditingEntry(null)
      setEditorContent('')
      setEditorLoading(false)
      setEditorSaving(false)
      return
    }
    void loadPath('/')
  }, [open, namespace, podName, containerName])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open && dialogRef.current) dialogRef.current.focus()
  }, [open])

  const breadcrumbs = useMemo(() => {
    const cleaned = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean)
    const result = [{ label: '/', path: '/' }]
    let built = ''
    for (const segment of cleaned) {
      built += `/${segment}`
      result.push({ label: segment, path: built })
    }
    return result
  }, [currentPath])

  const goUp = () => {
    if (currentPath === '/') return
    const parent = currentPath.split('/').filter(Boolean).slice(0, -1)
    const parentPath = parent.length === 0 ? '/' : `/${parent.join('/')}`
    void loadPath(parentPath)
  }

  useEffect(() => {
    if (!open) return
    const query = searchQuery.trim()
    if (query.startsWith('/')) {
      setSearchResults([])
      setSearching(false)
      if (searchAbortRef.current) {
        searchAbortRef.current.abort()
        searchAbortRef.current = null
      }
      return
    }
    if (!query) {
      setSearchResults([])
      setSearching(false)
      if (searchAbortRef.current) {
        searchAbortRef.current.abort()
        searchAbortRef.current = null
      }
      return
    }

    const timer = window.setTimeout(async () => {
      setSearching(true)
      if (searchAbortRef.current) {
        searchAbortRef.current.abort()
      }
      const controller = new AbortController()
      searchAbortRef.current = controller
      try {
        const res = await searchPodFilesystem(namespace, podName, containerName, query, '/', 1000, controller.signal)
        setSearchResults(res.entries || [])
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Search failed')
      } finally {
        setSearching(false)
      }
    }, 250)

    return () => {
      window.clearTimeout(timer)
      if (searchAbortRef.current) {
        searchAbortRef.current.abort()
        searchAbortRef.current = null
      }
    }
  }, [open, searchQuery, namespace, podName, containerName])

  const visibleEntries = useMemo(() => {
    const query = searchQuery.trim()
    if (!query) return entries
    if (query.startsWith('/')) return entries
    return searchResults
  }, [entries, searchQuery, searchResults])

  const handleSearchSubmit = async () => {
    const query = searchQuery.trim()
    if (!query.startsWith('/')) return
    setError(null)
    setSearchResults([])
    setSearching(true)
    try {
      await loadPath(query)
      setSearchQuery('')
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to open path: ${query}`)
    } finally {
      setSearching(false)
    }
  }

  const handleDownload = async (entry: PodFilesystemEntry) => {
    setActionPath(entry.path)
    try {
      const blob = entry.type === 'dir'
        ? await downloadPodArchive(namespace, podName, containerName, entry.path)
        : await downloadPodFile(namespace, podName, containerName, entry.path)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = entry.type === 'dir' ? `${entry.name}.zip` : entry.name
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setActionPath(null)
    }
  }

  const handleUpload = async (file: File) => {
    const destinationPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`
    setActionPath(destinationPath)
    try {
      await uploadPodFile(namespace, podName, containerName, destinationPath, file)
      await loadPath(currentPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      const lowered = message.toLowerCase()
      if (isForbiddenError(err) || lowered.includes('permission denied')) {
        setError('Upload failed: destination is not writable for this container user. Try a writable path like /tmp or your app data directory.')
      } else {
        setError(message)
      }
    } finally {
      setActionPath(null)
    }
  }

  const handleMkdir = async () => {
    const name = window.prompt('Folder name')
    if (!name || !name.trim()) return
    const folderName = name.trim()
    const targetPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`
    setActionPath(targetPath)
    try {
      await mkdirPodPath(namespace, podName, containerName, targetPath)
      await loadPath(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setActionPath(null)
    }
  }

  const handleRename = async (entry: PodFilesystemEntry) => {
    const nextName = window.prompt('Rename to', entry.name)
    if (!nextName || !nextName.trim() || nextName.trim() === entry.name) return
    const cleanName = nextName.trim()
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''
    const newPath = parent === '' ? `/${cleanName}` : `${parent}/${cleanName}`
    setActionPath(entry.path)
    try {
      await renamePodPath(namespace, podName, containerName, entry.path, newPath)
      await loadPath(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setActionPath(null)
    }
  }

  const handleDelete = async (entry: PodFilesystemEntry) => {
    const recursive = entry.type === 'dir'
    const confirmText = recursive
      ? `Delete folder "${entry.name}" and all contents?`
      : `Delete file "${entry.name}"?`
    if (!window.confirm(confirmText)) return
    const typed = window.prompt('Type "delete" to confirm')
    if ((typed || '').trim().toLowerCase() !== 'delete') return

    setActionPath(entry.path)
    try {
      await deletePodPath(namespace, podName, containerName, entry.path, recursive)
      // Optimistic removal so deleted entries disappear immediately in UI.
      setEntries((prev) => prev.filter((e) => e.path !== entry.path))
      setSearchResults((prev) => prev.filter((e) => e.path !== entry.path))
      void loadPath(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setActionPath(null)
    }
  }

  const handleEdit = async (entry: PodFilesystemEntry) => {
    setError(null)
    setEditingEntry(entry)
    setEditorLoading(true)
    try {
      const blob = await downloadPodFile(namespace, podName, containerName, entry.path)
      const text = await blob.text()
      setEditorContent(text)
    } catch (err) {
      setEditingEntry(null)
      setError(err instanceof Error ? err.message : 'Failed to open file for editing')
    } finally {
      setEditorLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingEntry) return
    setEditorSaving(true)
    setError(null)
    try {
      await savePodFile(namespace, podName, containerName, editingEntry.path, editorContent)
      setEditingEntry(null)
      setEditorContent('')
      await loadPath(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setEditorSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative bg-theme-surface border border-theme-border rounded-lg shadow-2xl w-full max-w-5xl mx-4 max-h-[85vh] flex flex-col outline-none"
      >
        <div className="flex items-center justify-between p-4 border-b border-theme-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-theme-text-primary">Live Container Filesystem</h3>
            <p className="text-sm text-theme-text-secondary truncate">
              {namespace}/{podName} • {containerName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-elevated rounded ml-4"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 border-b border-theme-border shrink-0 flex items-center gap-2 flex-wrap">
          <button
            onClick={goUp}
            disabled={currentPath === '/' || loading}
            className="px-3 py-1.5 text-xs rounded bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
          >
            Up
          </button>
          {breadcrumbs.map((crumb) => (
            <button
              key={crumb.path}
              onClick={() => void loadPath(crumb.path)}
              className="text-xs px-2 py-1 rounded hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary"
            >
              {crumb.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => void loadPath(currentPath)}
            disabled={loading}
            className="p-2 rounded hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
            title="Refresh"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <button
            onClick={handleMkdir}
            disabled={loading}
            className="p-2 rounded hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
            title="Create folder"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={loading}
            className="p-2 rounded hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
            title="Upload file"
          >
            <Upload className="w-4 h-4" />
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleUpload(file)
              e.currentTarget.value = ''
            }}
          />
        </div>
        <div className="px-3 py-2 border-b border-theme-border shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleSearchSubmit()
                }
              }}
              placeholder='Fuzzy search or type "/exact/path" then Enter'
              className="w-full pl-9 pr-3 py-1.5 rounded bg-theme-base border border-theme-border text-sm text-theme-text-primary placeholder-theme-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {error && (
            <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <span className="text-sm text-red-300">{error}</span>
            </div>
          )}

          {(loading || searching) && visibleEntries.length === 0 ? (
            <div className="h-40 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="text-sm text-theme-text-tertiary text-center py-8">
              {searchQuery.trim() ? 'No matching entries' : 'Empty directory'}
            </div>
          ) : (
            <div className="divide-y divide-theme-border rounded-lg border border-theme-border overflow-hidden">
              {visibleEntries.map((entry) => {
                const busy = actionPath === entry.path
                return (
                  <div key={entry.path} className="px-3 py-2 flex items-center gap-3 bg-theme-surface">
                    <button
                      className={clsx(
                        'flex items-center gap-2 min-w-0 text-left flex-1',
                        entry.type === 'dir' ? 'hover:text-blue-400' : 'text-theme-text-primary'
                      )}
                      onClick={() => {
                        if (entry.type === 'dir') void loadPath(entry.path)
                      }}
                    >
                      {entry.type === 'dir' ? (
                        <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <File className="w-4 h-4 text-theme-text-tertiary shrink-0" />
                      )}
                      <span className="truncate">{entry.name}</span>
                      {searchQuery.trim() && (
                        <span className="text-xs text-theme-text-tertiary truncate ml-2">{entry.path}</span>
                      )}
                    </button>
                    <span className="text-xs text-theme-text-tertiary w-24 text-right">
                      {entry.type === 'dir' ? 'dir' : formatBytes(entry.size)}
                    </span>
                    <span className="text-xs text-theme-text-tertiary w-20 text-right">{entry.permissions || '-'}</span>
                    <button
                      onClick={() => void handleRename(entry)}
                      disabled={busy || loading}
                      className="px-2 py-1 text-xs rounded hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                    >
                      Rename
                    </button>
                    {isEditableFile(entry) && (
                      <button
                        onClick={() => void handleEdit(entry)}
                        disabled={busy || loading}
                        className="p-1.5 rounded hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                        title="Edit"
                      >
                        <PencilLine className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => void handleDownload(entry)}
                      disabled={busy || loading}
                      className="p-1.5 rounded hover:bg-theme-elevated text-theme-text-secondary hover:text-blue-400 disabled:opacity-50"
                      title={entry.type === 'dir' ? 'Download as zip' : 'Download'}
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => void handleDelete(entry)}
                      disabled={busy || loading}
                      className="p-1.5 rounded hover:bg-red-500/20 text-theme-text-secondary hover:text-red-400 disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {editingEntry && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => !editorSaving && setEditingEntry(null)} />
          <div className="relative bg-theme-surface border border-theme-border rounded-lg shadow-2xl w-full max-w-6xl mx-4 h-[78vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-theme-border">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-theme-text-primary truncate">Edit File</div>
                <div className="text-xs text-theme-text-secondary truncate">{editingEntry.path}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={editorLoading || editorSaving}
                  className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {editorSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button
                  onClick={() => !editorSaving && setEditingEntry(null)}
                  disabled={editorSaving}
                  className="p-2 rounded hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {editorLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                </div>
              ) : (
                <Editor
                  height="100%"
                  language={detectLanguage(editingEntry.name)}
                  value={editorContent}
                  onChange={(v) => setEditorContent(v ?? '')}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    wordWrap: 'on',
                    automaticLayout: true,
                    tabSize: 2,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function isEditableFile(entry: PodFilesystemEntry): boolean {
  if (entry.type !== 'file' && entry.type !== 'symlink') return false
  if (entry.size > 2*1024*1024) return false
  return true
}

function detectLanguage(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.go')) return 'go'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  if (lower.endsWith('.xml')) return 'xml'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower === 'dockerfile') return 'shell'
  if (lower.endsWith('.sql')) return 'sql'
  return 'plaintext'
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** idx
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`
}
