import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import Editor from '@monaco-editor/react'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  File,
  Folder,
  FolderPlus,
  Loader2,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  deletePodPath,
  downloadPodFile,
  getPodFilesystem,
  isForbiddenError,
  mkdirPodPath,
  renamePodPath,
  savePodFile,
  searchPodFilesystem,
  type PodFilesystemEntry,
} from '../../api/client'
import { useOpenTerminal } from '../dock'
import { useToast } from '../ui/Toast'

interface PodFilesystemViewProps {
  namespace: string
  podName: string
  containerName: string
  initialPath?: string
  onBack: () => void
}

const MAX_PREVIEW_BYTES = 1024 * 1024
type PreviewKind = 'text' | 'image' | 'pdf' | 'video' | 'audio' | 'unsupported'

interface PreviewState {
  kind: PreviewKind
  text: string
  objectUrl: string | null
}

interface OperationState {
  visible: boolean
  title: string
  detail: string
  progress: number | null
  status: 'running' | 'success' | 'error'
}

export function PodFilesystemView({
  namespace,
  podName,
  containerName,
  initialPath = '/',
  onBack,
}: PodFilesystemViewProps) {
  const { showError, showSuccess } = useToast()
  const openTerminal = useOpenTerminal()
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const loadRequestIdRef = useRef(0)
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [entries, setEntries] = useState<PodFilesystemEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionPath, setActionPath] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [pathInput, setPathInput] = useState(initialPath)
  const [pathHistory, setPathHistory] = useState<string[]>([initialPath])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<PodFilesystemEntry[]>([])
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null)
  const [selectedDownloadPaths, setSelectedDownloadPaths] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<PreviewState>({ kind: 'unsupported', text: '', objectUrl: null })
  const [previewLoading, setPreviewLoading] = useState(false)
  const [editingEntry, setEditingEntry] = useState<PodFilesystemEntry | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorSaving, setEditorSaving] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const [operation, setOperation] = useState<OperationState>({
    visible: false,
    title: '',
    detail: '',
    progress: null,
    status: 'running',
  })

  const startOperation = (title: string, detail: string, progress: number | null = null) => {
    setOperation({ visible: true, title, detail, progress, status: 'running' })
  }

  const updateOperation = (detail: string, progress: number | null = operation.progress) => {
    setOperation((prev) => ({ ...prev, visible: true, detail, progress }))
  }

  const finishOperation = (status: 'success' | 'error', title: string, detail: string) => {
    setOperation((prev) => ({ ...prev, visible: true, title, detail, status, progress: status === 'success' ? 100 : prev.progress }))
    window.setTimeout(() => {
      setOperation((prev) => ({ ...prev, visible: false }))
    }, 1800)
  }

  const loadPath = async (targetPath: string): Promise<string | null> => {
    const requestId = ++loadRequestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await getPodFilesystem(namespace, podName, containerName, targetPath)
      if (requestId !== loadRequestIdRef.current) return null
      const resolvedPath = data.currentPath || targetPath
      setCurrentPath(resolvedPath)
      setEntries(data.entries || [])
      setSelectedDownloadPaths(new Set())
      setSelectedEntryPath((prev) => {
        if (prev && data.entries?.some((entry) => entry.path === prev)) {
          return prev
        }
        return data.entries?.[0]?.path || null
      })
      return resolvedPath
    } catch (err) {
      if (requestId !== loadRequestIdRef.current) return null
      setError(err instanceof Error ? err.message : 'Failed to load directory')
      return null
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!namespace || !podName || !containerName) return
    void (async () => {
      const resolvedPath = await loadPath(initialPath)
      if (resolvedPath) {
        setPathHistory([resolvedPath])
        setHistoryIndex(0)
      }
    })()
  }, [initialPath, namespace, podName, containerName])

  useEffect(() => {
    setPathInput(currentPath)
  }, [currentPath])

  const navigateToPath = async (targetPath: string, mode: 'push' | 'replace-history' | 'skip-history' = 'push') => {
    const resolvedPath = await loadPath(targetPath)
    if (!resolvedPath) return

    if (mode === 'skip-history') return

    if (mode === 'replace-history') {
      setPathHistory((prev) => {
        const next = [...prev]
        next[historyIndex] = resolvedPath
        return next
      })
      return
    }

    setPathHistory((prev) => {
      const current = prev[historyIndex]
      if (current === resolvedPath) return prev
      const truncated = prev.slice(0, historyIndex + 1)
      truncated.push(resolvedPath)
      setHistoryIndex(truncated.length - 1)
      return truncated
    })
  }

  const handleHistoryNavigate = async (direction: -1 | 1) => {
    const nextIndex = historyIndex + direction
    const nextPath = pathHistory[nextIndex]
    if (!nextPath) return
    const resolvedPath = await loadPath(nextPath)
    if (!resolvedPath) return
    setHistoryIndex(nextIndex)
    if (resolvedPath !== nextPath) {
      setPathHistory((prev) => {
        const next = [...prev]
        next[nextIndex] = resolvedPath
        return next
      })
    }
  }

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

  const visibleEntries = useMemo(() => {
    const query = searchQuery.trim()
    if (!query) return entries
    if (query.startsWith('/')) return entries
    return searchResults
  }, [entries, searchQuery, searchResults])

  const selectedEntry = useMemo(() => {
    return visibleEntries.find((entry) => entry.path === selectedEntryPath)
      || entries.find((entry) => entry.path === selectedEntryPath)
      || null
  }, [entries, selectedEntryPath, visibleEntries])

  const selectedDownloadEntries = useMemo(() => {
    if (selectedDownloadPaths.size === 0) return []
    const pathSet = selectedDownloadPaths
    return entries.filter((entry) => pathSet.has(entry.path))
  }, [entries, selectedDownloadPaths])

  const directoryEntries = useMemo(
    () => entries.filter((entry) => entry.type === 'dir'),
    [entries]
  )

  useEffect(() => {
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
  }, [searchQuery, namespace, podName, containerName])

  useEffect(() => {
    if (!selectedEntry || !isPreviewableFile(selectedEntry)) {
      setPreview((prev) => {
        if (prev.objectUrl) URL.revokeObjectURL(prev.objectUrl)
        return { kind: 'unsupported', text: '', objectUrl: null }
      })
      setPreviewLoading(false)
      return
    }

    const controller = new AbortController()
    setPreviewLoading(true)
    setPreview((prev) => {
      if (prev.objectUrl) URL.revokeObjectURL(prev.objectUrl)
      return { kind: 'unsupported', text: '', objectUrl: null }
    })

    void (async () => {
      try {
        const blob = await downloadPodFile(namespace, podName, containerName, selectedEntry.path)
        if (controller.signal.aborted) return
        const kind = getPreviewKind(selectedEntry.name)
        if (kind === 'text') {
          setPreview({ kind, text: await blob.text(), objectUrl: null })
        } else if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio') {
          setPreview({ kind, text: '', objectUrl: URL.createObjectURL(blob) })
        } else {
          setPreview({ kind: 'unsupported', text: '', objectUrl: null })
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setPreview({ kind: 'unsupported', text: '', objectUrl: null })
        setError(err instanceof Error ? err.message : 'Failed to preview file')
      } finally {
        if (!controller.signal.aborted) {
          setPreviewLoading(false)
        }
      }
    })()

    return () => controller.abort()
  }, [selectedEntry, namespace, podName, containerName])

  useEffect(() => {
    return () => {
      setPreview((prev) => {
        if (prev.objectUrl) URL.revokeObjectURL(prev.objectUrl)
        return prev
      })
    }
  }, [])

  const handleSearchSubmit = async () => {
    const query = searchQuery.trim()
    if (!query.startsWith('/')) return
    setSearching(true)
    setSearchResults([])
    try {
      await navigateToPath(query)
      setSearchQuery('')
    } finally {
      setSearching(false)
    }
  }

  const handlePathSubmit = async () => {
    const trimmed = pathInput.trim()
    if (!trimmed) return
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
    await navigateToPath(normalized)
  }

  const handleOpenTerminal = () => {
    if (!namespace || !podName || !containerName) return
    openTerminal({
      namespace,
      podName,
      containerName,
      containers: [containerName],
      workingDir: currentPath,
    })
  }

  const refreshCurrentDirectory = async () => {
    await loadPath(currentPath)

    const query = searchQuery.trim()
    if (query && !query.startsWith('/')) {
      try {
        const res = await searchPodFilesystem(namespace, podName, containerName, query, '/', 1000)
        setSearchResults(res.entries || [])
      } catch {
        // Keep the main directory refresh successful even if the follow-up search refresh fails.
      }
    }
  }

  const handleDownload = async (entry: PodFilesystemEntry) => {
    setActionPath(entry.path)
    try {
      startOperation(
        entry.type === 'dir' ? 'Downloading folder' : 'Downloading file',
        entry.name,
        0
      )
      const blob = await downloadWithProgress(entry)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = entry.type === 'dir' ? `${entry.name}.zip` : entry.name
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      finishOperation('success', 'Download complete', entry.name)
      showSuccess('Download complete', entry.type === 'dir' ? `${entry.name}.zip is ready` : `${entry.name} is ready`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed'
      setError(message)
      finishOperation('error', 'Download failed', message)
      showError('Download failed', message)
    } finally {
      setActionPath(null)
    }
  }

  const handleBulkDownload = async () => {
    if (selectedDownloadEntries.length === 0) return

    startOperation(
      selectedDownloadEntries.length === 1 ? 'Downloading selection' : 'Downloading selected entries',
      `${selectedDownloadEntries.length} item${selectedDownloadEntries.length === 1 ? '' : 's'}`,
      0
    )

    try {
      for (let i = 0; i < selectedDownloadEntries.length; i += 1) {
        const entry = selectedDownloadEntries[i]
        setActionPath(entry.path)
        updateOperation(entry.name, Math.round((i / selectedDownloadEntries.length) * 100))
        const blob = await downloadWithProgress(entry)
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = entry.type === 'dir' ? `${entry.name}.zip` : entry.name
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }

      finishOperation('success', 'Bulk download complete', `${selectedDownloadEntries.length} item${selectedDownloadEntries.length === 1 ? '' : 's'} downloaded`)
      showSuccess('Bulk download complete', `${selectedDownloadEntries.length} item${selectedDownloadEntries.length === 1 ? '' : 's'} downloaded`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk download failed'
      setError(message)
      finishOperation('error', 'Bulk download failed', message)
      showError('Bulk download failed', message)
    } finally {
      setActionPath(null)
    }
  }

  const toggleDownloadSelection = (entryPath: string, checked: boolean) => {
    setSelectedDownloadPaths((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(entryPath)
      } else {
        next.delete(entryPath)
      }
      return next
    })
  }

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedDownloadPaths((prev) => {
      const next = new Set(prev)
      for (const entry of visibleEntries) {
        if (checked) {
          next.add(entry.path)
        } else {
          next.delete(entry.path)
        }
      }
      return next
    })
  }

  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((entry) => selectedDownloadPaths.has(entry.path))
  const someVisibleSelected = visibleEntries.some((entry) => selectedDownloadPaths.has(entry.path))

  const handleUpload = async (file: File) => {
    const destinationPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`
    setActionPath(destinationPath)
    try {
      startOperation('Uploading file', file.name, 0)
      await uploadWithProgress(destinationPath, file)
      await refreshCurrentDirectory()
      finishOperation('success', 'Upload complete', file.name)
      showSuccess('Upload complete', `${file.name} uploaded to ${currentPath}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      const lowered = message.toLowerCase()
      if (isForbiddenError(err) || lowered.includes('permission denied')) {
        setError('Upload failed: destination is not writable for this container user. Try a writable path like /tmp or your app data directory.')
        finishOperation('error', 'Upload failed', 'Destination is not writable for this container user.')
        showError('Upload failed', 'Destination is not writable for this container user. Try /tmp or your app data directory.')
      } else {
        setError(message)
        finishOperation('error', 'Upload failed', message)
        showError('Upload failed', message)
      }
    } finally {
      setActionPath(null)
    }
  }

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0) return
    for (const file of files) {
      await handleUpload(file)
    }
  }

  const handleMkdir = async () => {
    const name = window.prompt('Folder name')
    if (!name || !name.trim()) return
    const folderName = name.trim()
    const targetPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`
    setActionPath(targetPath)
    try {
      startOperation('Creating folder', folderName)
      await mkdirPodPath(namespace, podName, containerName, targetPath)
      await refreshCurrentDirectory()
      finishOperation('success', 'Folder created', folderName)
      showSuccess('Folder created', targetPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create folder'
      setError(message)
      finishOperation('error', 'Create folder failed', message)
      showError('Create folder failed', message)
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
      startOperation('Renaming entry', `${entry.name} -> ${cleanName}`)
      await renamePodPath(namespace, podName, containerName, entry.path, newPath)
      await refreshCurrentDirectory()
      setSelectedEntryPath(newPath)
      finishOperation('success', 'Rename complete', cleanName)
      showSuccess('Rename complete', `${entry.name} renamed to ${cleanName}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rename failed'
      setError(message)
      finishOperation('error', 'Rename failed', message)
      showError('Rename failed', message)
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
      startOperation(recursive ? 'Deleting folder' : 'Deleting file', entry.name)
      await deletePodPath(namespace, podName, containerName, entry.path, recursive)
      setSelectedEntryPath((prev) => (prev === entry.path ? null : prev))
      await refreshCurrentDirectory()
      finishOperation('success', 'Delete complete', entry.name)
      showSuccess('Delete complete', `${entry.name} was removed`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed'
      setError(message)
      finishOperation('error', 'Delete failed', message)
      showError('Delete failed', message)
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
      startOperation('Saving file', editingEntry.name)
      await savePodFile(namespace, podName, containerName, editingEntry.path, editorContent)
      setEditingEntry(null)
      setEditorContent('')
      await refreshCurrentDirectory()
      finishOperation('success', 'Save complete', editingEntry.name)
      showSuccess('File saved', editingEntry.path)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save file'
      setError(message)
      finishOperation('error', 'Save failed', message)
      showError('Save failed', message)
    } finally {
      setEditorSaving(false)
    }
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.dataTransfer?.types.includes('Files')) return
    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.dataTransfer?.types.includes('Files')) return
    event.dataTransfer.dropEffect = 'copy'
    setIsDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.dataTransfer?.types.includes('Files')) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setIsDragActive(false)

    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.size >= 0)
    if (files.length === 0) return

    try {
      await handleUploadFiles(files)
    } catch {
      // Individual upload handlers surface their own errors/toasts.
    }
  }

  const downloadWithProgress = async (entry: PodFilesystemEntry): Promise<Blob> => {
    const params = new URLSearchParams()
    if (containerName) params.set('container', containerName)
    params.set('path', entry.path)
    const endpoint = entry.type === 'dir' ? 'archive' : 'file'
    const response = await fetch(`/api/pods/${namespace}/${podName}/filesystem/${endpoint}?${params.toString()}`)
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `HTTP ${response.status}`)
    }
    return readBlobWithProgress(response, (progress) => {
      updateOperation(entry.name, progress)
    })
  }

  const uploadWithProgress = (destinationPath: string, file: File): Promise<void> => {
    const params = new URLSearchParams()
    if (containerName) params.set('container', containerName)
    params.set('path', destinationPath)

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/pods/${namespace}/${podName}/filesystem/upload?${params.toString()}`)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          updateOperation(file.name, Math.round((event.loaded / event.total) * 100))
        } else {
          updateOperation(file.name, null)
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          updateOperation(file.name, 100)
          resolve()
          return
        }
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string }
          reject(new Error(parsed.error || `HTTP ${xhr.status}`))
        } catch {
          reject(new Error(`HTTP ${xhr.status}`))
        }
      }

      xhr.onerror = () => reject(new Error('Network error during upload'))

      const formData = new FormData()
      formData.append('file', file)
      xhr.send(formData)
    })
  }

  return (
    <div className="flex h-full w-full bg-theme-base">
      {operation.visible && (
        <div className="fixed right-6 bottom-24 z-[70] w-[360px] rounded-2xl border border-theme-border bg-theme-surface shadow-2xl">
          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-theme-text-primary">{operation.title}</div>
                <div className="mt-1 text-xs text-theme-text-secondary break-words">{operation.detail}</div>
              </div>
              {operation.status === 'running' ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
              ) : operation.status === 'success' ? (
                <div className="text-xs font-medium text-green-500 shrink-0">Done</div>
              ) : (
                <div className="text-xs font-medium text-red-500 shrink-0">Failed</div>
              )}
            </div>
            <div className="mt-4">
              <div className="h-2 rounded-full bg-theme-elevated overflow-hidden">
                {operation.progress == null ? (
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
                ) : (
                  <div
                    className={clsx(
                      'h-full rounded-full transition-[width] duration-200',
                      operation.status === 'error' ? 'bg-red-500' : operation.status === 'success' ? 'bg-green-500' : 'bg-blue-500'
                    )}
                    style={{ width: `${Math.max(6, Math.min(operation.progress, 100))}%` }}
                  />
                )}
              </div>
              <div className="mt-2 text-right text-xs text-theme-text-tertiary">
                {operation.progress == null ? 'Processing…' : `${Math.round(operation.progress)}%`}
              </div>
            </div>
          </div>
        </div>
      )}
      {!namespace || !podName || !containerName ? (
        <div className="m-auto max-w-lg rounded-2xl border border-theme-border bg-theme-surface p-6 text-center">
          <div className="text-lg font-semibold text-theme-text-primary">Filesystem target is missing</div>
          <div className="mt-2 text-sm text-theme-text-secondary">
            Open the live filesystem from a pod container action so Radar knows which pod and container to browse.
          </div>
          <button
            onClick={onBack}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
          >
            <ArrowLeft className="w-4 h-4" />
            Go back
          </button>
        </div>
      ) : (
      <>
      <aside className="w-72 shrink-0 border-r border-theme-border bg-theme-surface overflow-y-auto">
        <div className="p-4 border-b border-theme-border">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="mt-4">
            <h2 className="text-lg font-semibold text-theme-text-primary">Live Filesystem</h2>
            <p className="text-sm text-theme-text-secondary mt-1 break-all">
              {namespace}/{podName}
            </p>
            <p className="text-xs text-theme-text-tertiary mt-1">Container: {containerName}</p>
          </div>
        </div>

        <div className="p-3 border-b border-theme-border">
          <button
            onClick={() => void navigateToPath('/')}
            className={clsx(
              'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
              currentPath === '/'
                ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                : 'text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary'
            )}
          >
            Root
          </button>
        </div>

        <div className="p-2">
          <div className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-theme-text-tertiary">
            Folders Here
          </div>
          <div className="space-y-1">
            {directoryEntries.length === 0 ? (
              <div className="px-2 py-3 text-sm text-theme-text-tertiary">No subfolders</div>
            ) : (
              directoryEntries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => void navigateToPath(entry.path)}
                  className={clsx(
                    'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    currentPath === entry.path
                      ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                      : 'text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <div
        className="flex-1 min-w-0 flex flex-col relative"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => void handleDrop(e)}
      >
        {isDragActive && (
          <div className="absolute inset-4 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-sm pointer-events-none">
            <div className="rounded-2xl border border-blue-500/30 bg-theme-surface/95 px-8 py-6 text-center shadow-xl">
              <Upload className="mx-auto h-8 w-8 text-blue-500" />
              <div className="mt-3 text-lg font-semibold text-theme-text-primary">Drop files to upload</div>
              <div className="mt-1 text-sm text-theme-text-secondary">
                Files will be uploaded to <span className="font-medium text-theme-text-primary">{currentPath}</span>
              </div>
            </div>
          </div>
        )}
        <div className="border-b border-theme-border bg-theme-surface">
          <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void handleHistoryNavigate(-1)}
              disabled={loading || historyIndex === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-theme-border px-3 py-2.5 text-sm font-medium text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary disabled:opacity-50"
              title="Back"
            >
              <ChevronLeft className="w-4 h-4 text-violet-500" />
            </button>
            <button
              onClick={() => void handleHistoryNavigate(1)}
              disabled={loading || historyIndex >= pathHistory.length - 1}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-theme-border px-3 py-2.5 text-sm font-medium text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary disabled:opacity-50"
              title="Forward"
            >
              <ChevronRight className="w-4 h-4 text-violet-500" />
            </button>
            <button
              onClick={() => void loadPath(currentPath)}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-theme-border px-4 py-2.5 text-sm font-medium text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary disabled:opacity-50"
              title="Refresh"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin text-sky-500" /> : <RefreshCw className="w-4 h-4 text-sky-500" />}
              Refresh
            </button>
            <button
              onClick={() => uploadInputRef.current?.click()}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-theme-border px-4 py-2.5 text-sm font-medium text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary disabled:opacity-50"
              title="Upload file"
            >
              <Upload className="w-4 h-4 text-blue-500" />
              Upload file
            </button>
            <button
              onClick={handleMkdir}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-theme-border px-4 py-2.5 text-sm font-medium text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary disabled:opacity-50"
              title="Create folder"
            >
              <FolderPlus className="w-4 h-4 text-amber-500" />
              New folder
            </button>
            <button
              onClick={handleOpenTerminal}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-theme-border px-4 py-2.5 text-sm font-medium text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary disabled:opacity-50"
              title="Open terminal in current path"
            >
              <TerminalSquare className="w-4 h-4 text-emerald-400" />
              Terminal
            </button>
            {selectedDownloadEntries.length > 0 ? (
              <button
                onClick={() => void handleBulkDownload()}
                disabled={loading || selectedDownloadEntries.some((entry) => actionPath === entry.path)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                title="Download selected entries"
              >
                <Download className="w-4 h-4 text-white" />
                {selectedDownloadEntries.length === 1 ? 'Download selected item' : `Download selected (${selectedDownloadEntries.length})`}
              </button>
            ) : selectedEntry ? (
              <button
                onClick={() => void handleDownload(selectedEntry)}
                disabled={loading || actionPath === selectedEntry.path}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                title={selectedEntry.type === 'dir' ? 'Download selected folder as zip' : 'Download selected file'}
              >
                {actionPath === selectedEntry.path ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Download className="w-4 h-4 text-white" />}
                {selectedEntry.type === 'dir' ? 'Download folder' : 'Download file'}
              </button>
            ) : null}
            {breadcrumbs.map((crumb) => (
              <button
                key={crumb.path}
                onClick={() => void navigateToPath(crumb.path)}
                className="px-2.5 py-1.5 rounded-lg text-sm text-theme-text-secondary hover:bg-theme-elevated hover:text-theme-text-primary"
              >
                {crumb.label}
              </button>
            ))}
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length > 0) void handleUploadFiles(files)
                e.currentTarget.value = ''
              }}
            />
          </div>

          <div className="px-4 pb-3">
            <div className="rounded-2xl border border-theme-border bg-theme-base p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-theme-text-tertiary">Path</div>
                <div className="truncate text-xs text-theme-text-secondary">{currentPath}</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handlePathSubmit()
                  }}
                  placeholder="/var/log"
                  className="w-full min-h-12 rounded-xl border border-theme-border bg-theme-surface px-4 py-3 text-sm font-medium text-theme-text-primary placeholder-theme-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => void handlePathSubmit()}
                  disabled={loading || !pathInput.trim()}
                  className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Go
                </button>
              </div>
            </div>
          </div>

          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSearchSubmit()
                }}
                placeholder='Search files or type "/exact/path" and press Enter'
                className="w-full min-h-12 pl-11 pr-4 py-3 rounded-xl bg-theme-base border border-theme-border text-sm font-medium text-theme-text-primary placeholder-theme-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="m-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <span className="text-sm text-red-300">{error}</span>
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 overflow-auto">
            {(loading || searching) && visibleEntries.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              </div>
            ) : visibleEntries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-theme-text-tertiary">
                {searchQuery.trim() ? 'No matching entries' : 'Empty directory'}
              </div>
            ) : (
              <div className="p-4">
                <div className="overflow-hidden rounded-2xl border border-theme-border bg-theme-surface">
                  <table className="w-full">
                    <thead className="bg-theme-elevated/40 border-b border-theme-border">
                      <tr>
                        <th className="px-4 py-3 w-12 text-left">
                          <input
                            type="checkbox"
                            aria-label="Select all visible entries"
                            checked={allVisibleSelected}
                            ref={(node) => {
                              if (node) node.indeterminate = !allVisibleSelected && someVisibleSelected
                            }}
                            onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                            className="h-4 w-4 rounded border-theme-border text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-theme-text-secondary">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-theme-text-secondary w-28">Size</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-theme-text-secondary w-28">Permissions</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-theme-text-secondary w-56">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border">
                      {visibleEntries.map((entry) => {
                        const busy = actionPath === entry.path
                        const isSelected = selectedEntry?.path === entry.path
                        return (
                          <tr
                            key={entry.path}
                            className={clsx(
                              'transition-colors',
                              isSelected ? 'bg-blue-500/10' : 'hover:bg-theme-elevated/30'
                            )}
                          >
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                aria-label={`Select ${entry.name}`}
                                checked={selectedDownloadPaths.has(entry.path)}
                                onChange={(e) => toggleDownloadSelection(entry.path, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                                className="h-4 w-4 rounded border-theme-border text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <button
                                className="flex items-center gap-3 min-w-0 text-left w-full"
                                onClick={() => setSelectedEntryPath(entry.path)}
                                onDoubleClick={() => {
                                  if (entry.type === 'dir') {
                                    void navigateToPath(entry.path)
                                  } else if (isEditableFile(entry)) {
                                    void handleEdit(entry)
                                  }
                                }}
                              >
                                {entry.type === 'dir' ? (
                                  <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                                ) : (
                                  <File className="w-4 h-4 text-theme-text-tertiary shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <div className="truncate text-sm text-theme-text-primary">{entry.name}</div>
                                  {searchQuery.trim() && (
                                    <div className="truncate text-xs text-theme-text-tertiary">{entry.path}</div>
                                  )}
                                </div>
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm text-theme-text-secondary">
                              {entry.type === 'dir' ? 'dir' : formatBytes(entry.size)}
                            </td>
                            <td className="px-4 py-3 text-sm text-theme-text-secondary">{entry.permissions || '-'}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                {entry.type === 'dir' && (
                                  <button
                                    onClick={() => void navigateToPath(entry.path)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary"
                                    title="Open folder"
                                  >
                                    <Eye className="w-4 h-4" />
                                    <span className="text-xs">Open</span>
                                  </button>
                                )}
                                {isEditableFile(entry) && (
                                  <button
                                    onClick={() => void handleEdit(entry)}
                                    disabled={busy || loading}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                                    title="Edit"
                                  >
                                    <PencilLine className="w-4 h-4" />
                                    <span className="text-xs">Edit</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => void handleRename(entry)}
                                  disabled={busy || loading}
                                  className="px-2.5 py-2 text-xs rounded-lg hover:bg-theme-elevated text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                                >
                                  Rename
                                </button>
                                <button
                                  onClick={() => void handleDownload(entry)}
                                  disabled={busy || loading}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg hover:bg-theme-elevated text-theme-text-secondary hover:text-blue-400 disabled:opacity-50"
                                  title={entry.type === 'dir' ? 'Download as zip' : 'Download'}
                                >
                                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                  <span className="text-xs">Download</span>
                                </button>
                                <button
                                  onClick={() => void handleDelete(entry)}
                                  disabled={busy || loading}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg hover:bg-red-500/20 text-theme-text-secondary hover:text-red-400 disabled:opacity-50"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span className="text-xs">Delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <aside className="w-[30rem] shrink-0 border-l border-theme-border bg-theme-surface overflow-auto">
            <div className="p-4 border-b border-theme-border">
              <div className="text-xs font-medium uppercase tracking-wide text-theme-text-tertiary">Preview</div>
              {selectedEntry ? (
                <>
                  <div className="mt-2 text-base font-semibold text-theme-text-primary break-all">{selectedEntry.name}</div>
                  <div className="mt-1 text-xs text-theme-text-tertiary break-all">{selectedEntry.path}</div>
                </>
              ) : (
                <div className="mt-2 text-sm text-theme-text-tertiary">Select a file or folder</div>
              )}
            </div>

            {selectedEntry ? (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <StatCard label="Type" value={selectedEntry.type} />
                  <StatCard label="Size" value={selectedEntry.type === 'dir' ? 'Directory' : formatBytes(selectedEntry.size)} />
                  <StatCard label="Permissions" value={selectedEntry.permissions || '-'} />
                  <StatCard label="Path depth" value={String(selectedEntry.path.split('/').filter(Boolean).length)} />
                </div>

                {selectedEntry.type === 'dir' ? (
                  <div className="rounded-xl border border-theme-border bg-theme-base p-4">
                    <div className="text-sm text-theme-text-secondary">
                      Open this directory to browse its contents or download it as a zip archive.
                    </div>
                    <div className="mt-3">
                      <button
                        onClick={() => void navigateToPath(selectedEntry.path)}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500"
                      >
                        <Folder className="w-4 h-4" />
                        Open directory
                      </button>
                    </div>
                  </div>
                ) : isPreviewableFile(selectedEntry) ? (
                  <div className="rounded-xl border border-theme-border overflow-hidden">
                    <div className="px-3 py-2 border-b border-theme-border bg-theme-elevated/40 text-xs uppercase tracking-wide text-theme-text-tertiary">
                      Inline preview
                    </div>
                    <div className="max-h-[34rem] overflow-auto bg-theme-base">
                      {previewLoading ? (
                        <div className="h-48 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                        </div>
                      ) : preview.kind === 'image' && preview.objectUrl ? (
                        <div className="p-4">
                          <img
                            src={preview.objectUrl}
                            alt={selectedEntry.name}
                            className="max-w-full rounded-lg border border-theme-border bg-white"
                          />
                        </div>
                      ) : preview.kind === 'pdf' && preview.objectUrl ? (
                        <iframe
                          src={preview.objectUrl}
                          title={selectedEntry.name}
                          className="h-[34rem] w-full bg-white"
                        />
                      ) : preview.kind === 'audio' && preview.objectUrl ? (
                        <div className="p-4">
                          <audio controls src={preview.objectUrl} className="w-full" />
                        </div>
                      ) : preview.kind === 'video' && preview.objectUrl ? (
                        <div className="p-4">
                          <video controls src={preview.objectUrl} className="max-h-[30rem] w-full rounded-lg bg-black" />
                        </div>
                      ) : preview.kind === 'text' ? (
                        <pre className="p-4 text-xs leading-6 text-theme-text-secondary whitespace-pre-wrap break-words">
                          {preview.text}
                        </pre>
                      ) : (
                        <div className="p-4 text-sm text-theme-text-secondary">
                          This file type does not support inline preview yet.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-theme-border bg-theme-base p-4 text-sm text-theme-text-secondary">
                    Preview is limited to supported files under {formatBytes(MAX_PREVIEW_BYTES)}.
                  </div>
                )}
              </div>
            ) : null}
          </aside>
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
      </>
      )}
    </div>
  )
}

async function readBlobWithProgress(response: Response, onProgress: (progress: number | null) => void): Promise<Blob> {
  const total = Number(response.headers.get('content-length') || '0')
  if (!response.body) {
    onProgress(total > 0 ? 100 : null)
    return response.blob()
  }

  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(new Uint8Array(value))
      loaded += value.length
      onProgress(total > 0 ? Math.round((loaded / total) * 100) : null)
    }
  }

  onProgress(100)
  return new Blob(chunks)
}

function isEditableFile(entry: PodFilesystemEntry): boolean {
  if (entry.type !== 'file' && entry.type !== 'symlink') return false
  return true
}

function isPreviewableFile(entry: PodFilesystemEntry): boolean {
  if (entry.type !== 'file' && entry.type !== 'symlink') return false
  return entry.size <= MAX_PREVIEW_BYTES
}

function getPreviewKind(name: string): PreviewKind {
  const lower = name.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return 'image'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (/\.(mp4|webm|mov|m4v|ogg)$/.test(lower)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/.test(lower)) return 'audio'
  if (isTextLikeFilename(lower)) return 'text'
  return 'unsupported'
}

function isTextLikeFilename(lower: string): boolean {
  return (
    lower.endsWith('.txt') ||
    lower.endsWith('.log') ||
    lower.endsWith('.md') ||
    lower.endsWith('.json') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.xml') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.ini') ||
    lower.endsWith('.toml') ||
    lower.endsWith('.conf') ||
    lower.endsWith('.config') ||
    lower.endsWith('.env') ||
    lower.endsWith('.properties') ||
    lower.endsWith('.sql') ||
    lower.endsWith('.sh') ||
    lower.endsWith('.bash') ||
    lower.endsWith('.zsh') ||
    lower.endsWith('.py') ||
    lower.endsWith('.go') ||
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.css') ||
    lower.endsWith('.scss') ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm') ||
    lower.endsWith('.java') ||
    lower.endsWith('.rb') ||
    lower.endsWith('.php') ||
    lower.endsWith('.c') ||
    lower.endsWith('.cc') ||
    lower.endsWith('.cpp') ||
    lower.endsWith('.h') ||
    lower.endsWith('.hpp') ||
    lower === 'dockerfile' ||
    lower === 'makefile'
  )
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-theme-border bg-theme-base p-3">
      <div className="text-xs uppercase tracking-wide text-theme-text-tertiary">{label}</div>
      <div className="mt-1 text-sm text-theme-text-primary break-words">{value}</div>
    </div>
  )
}
