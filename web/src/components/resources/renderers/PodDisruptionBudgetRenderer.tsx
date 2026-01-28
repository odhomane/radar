import { Shield, AlertTriangle, Activity } from 'lucide-react'
import { clsx } from 'clsx'
import { Section, PropertyList, Property, ConditionsSection, KeyValueBadgeList } from '../drawer-components'

interface PodDisruptionBudgetRendererProps {
  data: any
}

export function PodDisruptionBudgetRenderer({ data }: PodDisruptionBudgetRendererProps) {
  const spec = data.spec || {}
  const status = data.status || {}
  const matchLabels = spec.selector?.matchLabels || {}
  const hasSelector = Object.keys(matchLabels).length > 0

  // Determine budget type
  const hasMaxUnavailable = spec.maxUnavailable !== undefined && spec.maxUnavailable !== null
  const hasMinAvailable = spec.minAvailable !== undefined && spec.minAvailable !== null
  const budgetType = hasMaxUnavailable ? 'Max Unavailable' : hasMinAvailable ? 'Min Available' : undefined
  const budgetValue = hasMaxUnavailable ? spec.maxUnavailable : hasMinAvailable ? spec.minAvailable : undefined

  // Problem detection
  const disruptionsAllowed = status.disruptionsAllowed
  const expectedPods = status.expectedPods
  const currentHealthy = status.currentHealthy
  const desiredHealthy = status.desiredHealthy

  const noDisruptionsAllowed = disruptionsAllowed === 0 && expectedPods > 0
  const insufficientHealthy = currentHealthy !== undefined && desiredHealthy !== undefined && currentHealthy < desiredHealthy

  return (
    <>
      {/* Problem alerts */}
      {insufficientHealthy && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-400 mb-1">Issues Detected</div>
              <ul className="text-xs text-red-300 space-y-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-red-400/60 mt-0.5">•</span>
                  <span>Insufficient healthy pods ({currentHealthy} healthy, {desiredHealthy} desired)</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {noDisruptionsAllowed && !insufficientHealthy && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-yellow-400 mb-1">Issues Detected</div>
              <ul className="text-xs text-yellow-300 space-y-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-yellow-400/60 mt-0.5">•</span>
                  <span>No disruptions currently allowed</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <Section title="Budget" icon={Shield}>
        <PropertyList>
          <Property label="Budget Type" value={budgetType} />
          <Property label="Budget Value" value={budgetValue !== undefined ? String(budgetValue) : undefined} />
          <Property
            label="Disruptions"
            value={
              disruptionsAllowed !== undefined ? (
                <span className={clsx(
                  disruptionsAllowed > 0 ? 'text-green-400' : 'text-red-400'
                )}>
                  {disruptionsAllowed} allowed
                </span>
              ) : undefined
            }
          />
          <Property label="Eviction Policy" value={spec.unhealthyPodEvictionPolicy} />
        </PropertyList>
      </Section>

      <Section title="Pod Status" icon={Activity}>
        <PropertyList>
          <Property
            label="Current Healthy"
            value={
              currentHealthy !== undefined ? (
                <span className={clsx(
                  desiredHealthy !== undefined && currentHealthy >= desiredHealthy
                    ? 'text-green-400'
                    : 'text-red-400'
                )}>
                  {currentHealthy}
                </span>
              ) : undefined
            }
          />
          <Property label="Desired Healthy" value={desiredHealthy} />
          <Property label="Expected Pods" value={expectedPods} />
        </PropertyList>
        {currentHealthy !== undefined && expectedPods !== undefined && expectedPods > 0 && (
          <div className="mt-3 bg-theme-elevated/30 rounded p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-theme-text-secondary">Health</span>
              <span className={clsx(
                desiredHealthy !== undefined && currentHealthy >= desiredHealthy
                  ? 'text-green-400'
                  : 'text-red-400'
              )}>
                {currentHealthy}/{expectedPods} healthy
              </span>
            </div>
            <div className="mt-2 h-2 bg-theme-hover rounded overflow-hidden">
              <div
                className={clsx(
                  'h-full transition-all',
                  desiredHealthy !== undefined && currentHealthy >= desiredHealthy
                    ? 'bg-green-500'
                    : 'bg-red-500'
                )}
                style={{ width: `${Math.min(100, (currentHealthy / expectedPods) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </Section>

      <Section title="Selector">
        {hasSelector ? (
          <KeyValueBadgeList items={matchLabels} />
        ) : (
          <div className="text-sm text-theme-text-tertiary">All pods in namespace</div>
        )}
      </Section>

      <ConditionsSection conditions={status.conditions} />
    </>
  )
}
