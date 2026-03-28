import { useDeferredValue, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, Loader2, Search } from 'lucide-react'
import { useResources } from '../../api/client'

interface FilesystemBrowserViewProps {
  namespaces: string[]
  onOpenFilesystem: (target: { namespace: string; podName: string; containerName: string; path: string }) => void
}

interface PodSummary {
  namespace: string
  name: string
  phase: string
  nodeName: string
  containers: string[]
}

interface K8sPodLike {
  metadata?: {
    name?: string
    namespace?: string
  }
  spec?: {
    nodeName?: string
    containers?: Array<{ name?: string }>
  }
  status?: {
    phase?: string
  }
}

export function FilesystemBrowserView({ namespaces, onOpenFilesystem }: FilesystemBrowserViewProps) {
  const [query, setQuery] = useState('')
  const [expandedNamespaces, setExpandedNamespaces] = useState<Record<string, boolean>>({})
  const [showAllPodsByNamespace, setShowAllPodsByNamespace] = useState<Record<string, boolean>>({})
  const podsQuery = useResources<K8sPodLike>('pods')
  const deferredQuery = useDeferredValue(query)

  const pods = useMemo<PodSummary[]>(() => {
    const items = (podsQuery.data || [])
      .map((pod) => {
        const namespace = pod.metadata?.namespace || ''
        const name = pod.metadata?.name || ''
        const phase = pod.status?.phase || 'Unknown'
        const nodeName = pod.spec?.nodeName || '-'
        const containers = (pod.spec?.containers || [])
          .map((container) => container?.name || '')
          .filter(Boolean)

        return { namespace, name, phase, nodeName, containers }
      })
      .filter((pod) => pod.namespace && pod.name)
      .filter((pod) => pod.phase.toLowerCase() === 'running')
      .filter((pod) => pod.containers.length > 0)

    if (namespaces.length > 0) {
      const nsSet = new Set(namespaces)
      return items.filter((pod) => nsSet.has(pod.namespace))
    }
    return items
  }, [podsQuery.data, namespaces])

  const filteredPods = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase()
    if (!term) return pods
    return pods.filter((pod) => {
      if (pod.name.toLowerCase().includes(term)) return true
      if (pod.namespace.toLowerCase().includes(term)) return true
      if (pod.nodeName.toLowerCase().includes(term)) return true
      return pod.containers.some((container) => container.toLowerCase().includes(term))
    })
  }, [deferredQuery, pods])

  const namespaceSections = useMemo(() => {
    const grouped = new Map<string, PodSummary[]>()
    for (const pod of filteredPods) {
      const key = pod.namespace
      const list = grouped.get(key) || []
      list.push(pod)
      grouped.set(key, list)
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([namespace, items]) => ({
        namespace,
        pods: items.sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [filteredPods])

  const isNamespaceExpanded = (namespace: string) => {
    if (deferredQuery.trim()) return true
    return expandedNamespaces[namespace] ?? false
  }

  const toggleNamespace = (namespace: string) => {
    setExpandedNamespaces((prev) => ({ ...prev, [namespace]: !(prev[namespace] ?? false) }))
  }

  const toggleShowAllPods = (namespace: string) => {
    setShowAllPodsByNamespace((prev) => ({ ...prev, [namespace]: !(prev[namespace] ?? false) }))
  }

  return (
    <div className="flex-1 min-w-0 overflow-auto bg-theme-base">
      <div className="px-5 py-4 border-b border-theme">
        <div className="max-w-6xl">
          <h1 className="text-lg font-semibold text-theme-primary">Filesystem</h1>
          <p className="mt-1 text-sm text-theme-secondary">
            Select a running pod container to open live filesystem view.
          </p>
        </div>
      </div>

      <div className="px-5 py-4 border-b border-theme">
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pods, namespaces, nodes, containers"
            className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-theme bg-theme-surface text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </div>

      <div className="p-5 space-y-4 max-w-6xl">
        {podsQuery.isLoading && (
          <div className="flex items-center gap-2 text-theme-secondary">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading eligible pods...</span>
          </div>
        )}

        {podsQuery.error && (
          <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {podsQuery.error instanceof Error ? podsQuery.error.message : 'Failed to load pods'}
          </div>
        )}

        {!podsQuery.isLoading && !podsQuery.error && filteredPods.length === 0 && (
          <div className="rounded-lg border border-theme bg-theme-surface px-4 py-8 text-sm text-theme-secondary">
            No running pods with containers found for the current namespace filter.
          </div>
        )}

        {!podsQuery.isLoading && !podsQuery.error && filteredPods.length > 0 && (
          <div className="space-y-4">
            {namespaceSections.map((section, index) => (
              <section
                key={section.namespace}
                className="rounded-2xl border border-theme bg-gradient-to-r from-theme-surface to-theme-elevated shadow-[0_12px_30px_-18px_rgba(15,23,42,0.7)]"
              >
                <div
                  className="flex flex-wrap items-center justify-between gap-2 rounded-t-2xl px-4 py-3"
                  style={{
                    background:
                      index % 3 === 0
                        ? 'linear-gradient(135deg, rgba(14,116,144,0.2), rgba(2,132,199,0.1))'
                        : index % 3 === 1
                          ? 'linear-gradient(135deg, rgba(91,33,182,0.2), rgba(79,70,229,0.1))'
                          : 'linear-gradient(135deg, rgba(185,28,28,0.18), rgba(234,88,12,0.1))',
                  }}
                >
                  <button
                    onClick={() => toggleNamespace(section.namespace)}
                    className="min-w-0 inline-flex items-center gap-2 text-left rounded-md hover:bg-black/5 dark:hover:bg-white/10 px-1.5 py-1"
                  >
                    {isNamespaceExpanded(section.namespace) ? (
                      <ChevronDown className="w-4 h-4 text-theme-secondary" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-theme-secondary" />
                    )}
                    <div>
                      <h2 className="text-sm font-semibold text-theme-primary truncate">{section.namespace}</h2>
                      <p className="text-xs text-theme-secondary">
                        {section.pods.length} pod{section.pods.length === 1 ? '' : 's'} eligible for filesystem
                      </p>
                    </div>
                  </button>
                </div>

                {isNamespaceExpanded(section.namespace) && (
                  <div className="space-y-2.5 p-4">
                    {(showAllPodsByNamespace[section.namespace] ? section.pods : section.pods.slice(0, 10)).map((pod) => (
                    <div
                      key={`${pod.namespace}/${pod.name}`}
                      className="rounded-xl border border-theme bg-theme-surface p-3.5 shadow-[0_8px_22px_-16px_rgba(15,23,42,0.75)] transition-transform hover:-translate-y-0.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-theme-primary break-all">{pod.name}</div>
                          <div className="mt-1 text-xs text-theme-tertiary truncate">{pod.nodeName}</div>
                        </div>
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
                          {pod.phase}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {pod.containers.map((container) => (
                          <button
                            key={container}
                            onClick={() =>
                              onOpenFilesystem({
                                namespace: pod.namespace,
                                podName: pod.name,
                                containerName: container,
                                path: '/',
                              })
                            }
                            className="inline-flex items-center justify-between gap-2 rounded-lg border border-theme bg-theme-base px-3 py-2 text-left text-sm text-theme-primary shadow-[0_5px_14px_-10px_rgba(15,23,42,0.7)] hover:bg-theme-hover"
                          >
                            <span className="truncate">{container}</span>
                            <FolderOpen className="w-4 h-4 text-emerald-500 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                    ))}
                    {section.pods.length > 10 && (
                      <button
                        onClick={() => toggleShowAllPods(section.namespace)}
                        className="w-full rounded-lg border border-theme bg-theme-base px-3 py-2 text-sm text-theme-secondary hover:bg-theme-hover"
                      >
                        {showAllPodsByNamespace[section.namespace]
                          ? 'Show fewer pods'
                          : `Show ${section.pods.length - 10} more pods`}
                      </button>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
