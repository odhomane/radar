import { Server, HardDrive, Globe, AlertTriangle, Tag } from 'lucide-react'
import { clsx } from 'clsx'
import { Section, PropertyList, Property, ConditionsSection } from '../drawer-components'

interface NodeRendererProps {
  data: any
}

// Format Kubernetes memory values (e.g., "16384Ki" -> "16 GiB", "8Gi" -> "8 GiB")
function formatMemory(value: string | undefined): string {
  if (!value) return '-'

  // Parse numeric portion and suffix
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/)
  if (!match) return value

  const num = parseFloat(match[1])
  const suffix = match[2]

  // Convert to bytes first based on Kubernetes suffixes
  let bytes: number
  switch (suffix) {
    // Binary suffixes (powers of 1024)
    case 'Ki':
      bytes = num * 1024
      break
    case 'Mi':
      bytes = num * 1024 ** 2
      break
    case 'Gi':
      bytes = num * 1024 ** 3
      break
    case 'Ti':
      bytes = num * 1024 ** 4
      break
    // Decimal suffixes (powers of 1000)
    case 'k':
      bytes = num * 1000
      break
    case 'M':
      bytes = num * 1000 ** 2
      break
    case 'G':
      bytes = num * 1000 ** 3
      break
    case 'T':
      bytes = num * 1000 ** 4
      break
    // Plain bytes
    case '':
      bytes = num
      break
    default:
      return value
  }

  // Format to best human-readable binary unit
  if (bytes >= 1024 ** 4) {
    return `${(bytes / 1024 ** 4).toFixed(1)} TiB`
  } else if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  } else if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }
  return `${bytes} B`
}

// Format storage values the same way as memory
function formatStorage(value: string | undefined): string {
  return formatMemory(value)
}

// Extract problems from node status and spec
function getNodeProblems(data: any): string[] {
  const problems: string[] = []
  const conditions = data.status?.conditions || []
  const spec = data.spec || {}

  // Check if unschedulable
  if (spec.unschedulable) {
    problems.push('Node is cordoned (unschedulable)')
  }

  for (const cond of conditions) {
    // NotReady is a problem when status is not True
    if (cond.type === 'Ready' && cond.status !== 'True') {
      problems.push(`Node is NotReady${cond.message ? ': ' + cond.message : ''}`)
    }

    // These conditions are problems when True
    if (cond.status === 'True') {
      if (cond.type === 'DiskPressure') {
        problems.push(`Disk pressure${cond.message ? ': ' + cond.message : ''}`)
      }
      if (cond.type === 'MemoryPressure') {
        problems.push(`Memory pressure${cond.message ? ': ' + cond.message : ''}`)
      }
      if (cond.type === 'PIDPressure') {
        problems.push(`PID pressure${cond.message ? ': ' + cond.message : ''}`)
      }
      if (cond.type === 'NetworkUnavailable') {
        problems.push(`Network unavailable${cond.message ? ': ' + cond.message : ''}`)
      }
    }
  }

  return problems
}

export function NodeRenderer({ data }: NodeRendererProps) {
  const status = data.status || {}
  const spec = data.spec || {}
  const metadata = data.metadata || {}
  const labels = metadata.labels || {}
  const nodeInfo = status.nodeInfo || {}
  const capacity = status.capacity || {}
  const allocatable = status.allocatable || {}
  const addresses = status.addresses || []
  const taints = spec.taints || []

  // Check for problems
  const problems = getNodeProblems(data)
  const hasProblems = problems.length > 0

  // Extract platform info from labels
  const instanceType = labels['node.kubernetes.io/instance-type']
  const zone = labels['topology.kubernetes.io/zone']
  const region = labels['topology.kubernetes.io/region']
  const nodePool = labels['cloud.google.com/gke-nodepool'] || labels['eks.amazonaws.com/nodegroup']
  const machineFamily = labels['cloud.google.com/machine-family']
  const hasPlatformInfo = instanceType || zone || region || nodePool || machineFamily

  return (
    <>
      {/* Problems alert - shown at top when there are issues */}
      {hasProblems && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-400 mb-1">Issues Detected</div>
              <ul className="text-xs text-red-300 space-y-1">
                {problems.map((problem, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-red-400/60 mt-0.5">•</span>
                    <span>{problem}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Node Info */}
      <Section title="Node Info" icon={Server}>
        <PropertyList>
          <Property label="OS" value={nodeInfo.osImage} />
          <Property label="Architecture" value={nodeInfo.architecture} />
          <Property label="Kernel" value={nodeInfo.kernelVersion} />
          <Property label="Container Runtime" value={nodeInfo.containerRuntimeVersion} />
          <Property label="Kubelet" value={nodeInfo.kubeletVersion} />
          <Property label="Kube-Proxy" value={nodeInfo.kubeProxyVersion} />
        </PropertyList>
      </Section>

      {/* Capacity */}
      <Section title="Capacity" icon={HardDrive}>
        <div className="space-y-1">
          <div className="grid grid-cols-3 gap-2 text-xs text-theme-text-tertiary font-medium mb-2">
            <span>Resource</span>
            <span>Capacity</span>
            <span>Allocatable</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <span className="text-theme-text-secondary">CPU</span>
            <span className="text-theme-text-primary">{capacity.cpu || '-'}</span>
            <span className="text-theme-text-primary">{allocatable.cpu || '-'}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <span className="text-theme-text-secondary">Memory</span>
            <span className="text-theme-text-primary">{formatMemory(capacity.memory)}</span>
            <span className="text-theme-text-primary">{formatMemory(allocatable.memory)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <span className="text-theme-text-secondary">Pods</span>
            <span className="text-theme-text-primary">{capacity.pods || '-'}</span>
            <span className="text-theme-text-primary">{allocatable.pods || '-'}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <span className="text-theme-text-secondary">Ephemeral Storage</span>
            <span className="text-theme-text-primary">{formatStorage(capacity['ephemeral-storage'])}</span>
            <span className="text-theme-text-primary">{formatStorage(allocatable['ephemeral-storage'])}</span>
          </div>
        </div>
      </Section>

      {/* Addresses */}
      {addresses.length > 0 && (
        <Section title="Addresses" icon={Globe}>
          <PropertyList>
            {addresses.map((addr: any) => (
              <Property key={`${addr.type}-${addr.address}`} label={addr.type} value={addr.address} />
            ))}
          </PropertyList>
        </Section>
      )}

      {/* Platform Info */}
      {hasPlatformInfo && (
        <Section title="Platform" icon={Tag}>
          <PropertyList>
            <Property label="Instance Type" value={instanceType} />
            <Property label="Zone" value={zone} />
            <Property label="Region" value={region} />
            <Property label="Node Pool" value={nodePool} />
            <Property label="Machine Family" value={machineFamily} />
          </PropertyList>
        </Section>
      )}

      {/* Taints */}
      {taints.length > 0 && (
        <Section title={`Taints (${taints.length})`} defaultExpanded={taints.length <= 5}>
          <div className="space-y-1">
            {taints.map((taint: any, i: number) => (
              <div key={`${taint.key}-${taint.effect}-${i}`} className="text-sm">
                <span className={clsx(
                  'px-2 py-0.5 rounded text-xs',
                  taint.effect === 'NoSchedule' ? 'bg-yellow-500/20 text-yellow-400' :
                  taint.effect === 'NoExecute' ? 'bg-red-500/20 text-red-400' :
                  'bg-blue-500/20 text-blue-400'
                )}>
                  {taint.key}{taint.value ? `=${taint.value}` : ''}:{taint.effect}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Conditions */}
      <ConditionsSection conditions={status.conditions} />
    </>
  )
}
