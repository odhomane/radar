import { Server, AlertTriangle, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Section, PropertyList, Property, ConditionsSection, PodTemplateSection } from '../drawer-components'

interface WorkloadRendererProps {
  kind: string
  data: any
}

// Extract problems from workload status and conditions
function getWorkloadProblems(status: any, spec: any, kind: string): string[] {
  const problems: string[] = []

  const isDaemonSet = kind === 'daemonsets'

  // Check replica/pod counts
  if (isDaemonSet) {
    const ready = status.numberReady || 0
    const desired = status.desiredNumberScheduled || 0
    if (desired > 0 && ready < desired) {
      const notReady = desired - ready
      problems.push(`${notReady} of ${desired} pods are not ready`)
    }
    if (status.numberUnavailable > 0) {
      problems.push(`${status.numberUnavailable} pods are unavailable`)
    }
  } else {
    const ready = status.readyReplicas || 0
    const desired = spec.replicas || 0
    if (desired > 0 && ready < desired) {
      const notReady = desired - ready
      problems.push(`${notReady} of ${desired} replicas are not ready`)
    }
    if (status.unavailableReplicas > 0) {
      problems.push(`${status.unavailableReplicas} replicas are unavailable`)
    }
  }

  // Check conditions for more details
  const conditions = status.conditions || []
  for (const cond of conditions) {
    if (cond.status === 'False' && cond.message) {
      // Add the condition message as a problem
      problems.push(`${cond.type}: ${cond.message}`)
    }
    // Also check for conditions that are True but indicate problems (e.g., ReplicaFailure)
    if (cond.status === 'True' && cond.type === 'ReplicaFailure' && cond.message) {
      problems.push(cond.message)
    }
  }

  return problems
}

// Map plural lowercase kind to singular PascalCase for ownerReferences matching
function getOwnerKind(kind: string): string {
  const kindMap: Record<string, string> = {
    'daemonsets': 'DaemonSet',
    'deployments': 'Deployment',
    'statefulsets': 'StatefulSet',
    'replicasets': 'ReplicaSet',
    'jobs': 'Job',
  }
  return kindMap[kind] || kind
}

export function WorkloadRenderer({ kind, data }: WorkloadRendererProps) {
  const navigate = useNavigate()
  const status = data.status || {}
  const spec = data.spec || {}
  const metadata = data.metadata || {}

  const isDaemonSet = kind === 'daemonsets'
  const isStatefulSet = kind === 'statefulsets'

  // Check for problems
  const problems = getWorkloadProblems(status, spec, kind)
  const hasProblems = problems.length > 0

  // Build URL for viewing pods owned by this workload
  const viewPodsUrl = `/resources?kind=pods&ownerKind=${encodeURIComponent(getOwnerKind(kind))}&ownerName=${encodeURIComponent(metadata.name || '')}&namespace=${encodeURIComponent(metadata.namespace || '')}`

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
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-red-400/60">
                  Check Events below for details, or view individual pods for logs.
                </div>
                <button
                  onClick={() => navigate(viewPodsUrl)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  View Pods
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Section title="Status" icon={Server}>
        <PropertyList>
          {isDaemonSet ? (
            <>
              <Property label="Desired" value={status.desiredNumberScheduled} />
              <Property label="Current" value={status.currentNumberScheduled} />
              <Property label="Ready" value={status.numberReady} />
              <Property label="Up-to-date" value={status.updatedNumberScheduled} />
              <Property label="Available" value={status.numberAvailable} />
            </>
          ) : (
            <>
              <Property label="Replicas" value={`${status.readyReplicas || 0}/${spec.replicas || 0}`} />
              <Property label="Updated" value={status.updatedReplicas} />
              <Property label="Available" value={status.availableReplicas} />
              <Property label="Unavailable" value={status.unavailableReplicas} />
            </>
          )}
        </PropertyList>
        <div className="mt-3 pt-3 border-t border-theme-border">
          <button
            onClick={() => navigate(viewPodsUrl)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View Managed Pods
          </button>
        </div>
      </Section>

      <Section title="Strategy">
        <PropertyList>
          {isDaemonSet || isStatefulSet ? (
            <Property label="Update Strategy" value={spec.updateStrategy?.type} />
          ) : (
            <>
              <Property label="Strategy" value={spec.strategy?.type} />
              {spec.strategy?.rollingUpdate && (
                <>
                  <Property label="Max Surge" value={spec.strategy.rollingUpdate.maxSurge} />
                  <Property label="Max Unavailable" value={spec.strategy.rollingUpdate.maxUnavailable} />
                </>
              )}
            </>
          )}
          {isStatefulSet && (
            <>
              <Property label="Service Name" value={spec.serviceName} />
              <Property label="Pod Management" value={spec.podManagementPolicy || 'OrderedReady'} />
            </>
          )}
        </PropertyList>
      </Section>

      <Section title="Pod Template" defaultExpanded={false}>
        <PodTemplateSection template={spec.template} />
      </Section>

      <ConditionsSection conditions={status.conditions} />
    </>
  )
}
