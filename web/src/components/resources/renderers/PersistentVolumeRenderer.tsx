import { HardDrive, AlertTriangle, Link, Database, Server } from 'lucide-react'
import { clsx } from 'clsx'
import { Section, PropertyList, Property, ConditionsSection } from '../drawer-components'

interface PersistentVolumeRendererProps {
  data: any
}

const accessModeShorthand: Record<string, string> = {
  ReadWriteOnce: 'RWO',
  ReadOnlyMany: 'ROX',
  ReadWriteMany: 'RWX',
  ReadWriteOncePod: 'RWOP',
}

function formatAccessModes(modes: string[] | undefined): string | undefined {
  if (!modes || modes.length === 0) return undefined
  return modes.map(m => accessModeShorthand[m] || m).join(', ')
}

export function PersistentVolumeRenderer({ data }: PersistentVolumeRendererProps) {
  const status = data.status || {}
  const spec = data.spec || {}
  const phase = status.phase

  const claimRef = spec.claimRef
  const csi = spec.csi
  const nodeAffinity = spec.nodeAffinity

  // Problem detection
  const isFailed = phase === 'Failed'
  const isReleased = phase === 'Released'

  return (
    <>
      {/* Problem alerts */}
      {isFailed && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-400 mb-1">Issues Detected</div>
              <ul className="text-xs text-red-300 space-y-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-red-400/60 mt-0.5">•</span>
                  <span>PV has failed</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {isReleased && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-yellow-400 mb-1">Issues Detected</div>
              <ul className="text-xs text-yellow-300 space-y-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-yellow-400/60 mt-0.5">•</span>
                  <span>PV is released but not yet available or reclaimed</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Status */}
      <Section title="Status" icon={HardDrive}>
        <PropertyList>
          <Property
            label="Phase"
            value={
              <span className={clsx(
                (phase === 'Bound' || phase === 'Available') && 'text-green-400',
                phase === 'Released' && 'text-yellow-400',
                phase === 'Failed' && 'text-red-400',
              )}>
                {phase}
              </span>
            }
          />
          <Property label="Capacity" value={spec.capacity?.storage} />
          <Property label="Access Modes" value={formatAccessModes(spec.accessModes)} />
          <Property label="Volume Mode" value={spec.volumeMode} />
          <Property
            label="Reclaim Policy"
            value={
              spec.persistentVolumeReclaimPolicy ? (
                <span className={clsx(
                  spec.persistentVolumeReclaimPolicy === 'Delete' && 'text-red-400',
                  spec.persistentVolumeReclaimPolicy === 'Retain' && 'text-green-400',
                )}>
                  {spec.persistentVolumeReclaimPolicy}
                </span>
              ) : undefined
            }
          />
          <Property label="Storage Class" value={spec.storageClassName} />
        </PropertyList>
      </Section>

      {/* Claim Reference */}
      {claimRef && (
        <Section title="Claim" icon={Link}>
          <PropertyList>
            <Property label="Namespace" value={claimRef.namespace} />
            <Property label="Name" value={claimRef.name} />
            <Property label="UID" value={claimRef.uid} />
          </PropertyList>
        </Section>
      )}

      {/* CSI */}
      {csi && (
        <Section title="CSI" icon={Database}>
          <PropertyList>
            <Property label="Driver" value={csi.driver} />
            <Property label="Volume Handle" value={csi.volumeHandle} />
            <Property label="FS Type" value={csi.fsType} />
          </PropertyList>
        </Section>
      )}

      {/* Node Affinity */}
      {nodeAffinity?.required?.nodeSelectorTerms && nodeAffinity.required.nodeSelectorTerms.length > 0 && (
        <Section title="Node Affinity" icon={Server}>
          <div className="space-y-2">
            {nodeAffinity.required.nodeSelectorTerms.map((term: any, termIdx: number) => (
              <div key={termIdx} className="space-y-1">
                {term.matchExpressions?.map((expr: any, exprIdx: number) => (
                  <div key={exprIdx} className="flex flex-wrap gap-1">
                    <span className="px-2 py-0.5 bg-theme-elevated rounded text-xs text-theme-text-secondary">
                      {expr.key} {expr.operator} {expr.values?.join(', ')}
                    </span>
                  </div>
                ))}
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
