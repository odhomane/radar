import { HardDrive, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { Section, PropertyList, Property, ConditionsSection } from '../drawer-components'

interface PVCRendererProps {
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

export function PVCRenderer({ data }: PVCRendererProps) {
  const status = data.status || {}
  const spec = data.spec || {}
  const annotations = data.metadata?.annotations || {}
  const phase = status.phase

  // Problem detection
  const isLost = phase === 'Lost'
  const isPending = phase === 'Pending'
  const hasProblems = isLost || isPending

  // Provisioner info from annotations
  const provisioner = annotations['volume.kubernetes.io/storage-provisioner']
  const selectedNode = annotations['volume.kubernetes.io/selected-node']
  const bindCompleted = annotations['pv.kubernetes.io/bind-completed']
  const hasProvisionerInfo = provisioner || selectedNode || bindCompleted

  return (
    <>
      {/* Problem alerts */}
      {hasProblems && isLost && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-400 mb-1">Issues Detected</div>
              <ul className="text-xs text-red-300 space-y-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-red-400/60 mt-0.5">•</span>
                  <span>PVC has lost its bound volume</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {hasProblems && isPending && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-yellow-400 mb-1">Issues Detected</div>
              <ul className="text-xs text-yellow-300 space-y-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-yellow-400/60 mt-0.5">•</span>
                  <span>PVC is waiting to be bound to a volume</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <Section title="Status" icon={HardDrive}>
        <PropertyList>
          <Property
            label="Phase"
            value={
              <span className={clsx(
                phase === 'Bound' && 'text-green-400',
                phase === 'Pending' && 'text-yellow-400',
                phase === 'Lost' && 'text-red-400',
              )}>
                {phase}
              </span>
            }
          />
          <Property label="Capacity" value={status.capacity?.storage} />
          <Property label="Requested" value={spec.resources?.requests?.storage} />
          <Property label="Storage Class" value={spec.storageClassName} />
          <Property label="Access Modes" value={formatAccessModes(spec.accessModes)} />
          <Property label="Volume Mode" value={spec.volumeMode} />
          <Property label="Volume Name" value={spec.volumeName} />
        </PropertyList>
      </Section>

      {hasProvisionerInfo && (
        <Section title="Provisioner Info">
          <PropertyList>
            <Property label="Provisioner" value={provisioner} />
            <Property label="Selected Node" value={selectedNode} />
            <Property label="Bind Completed" value={bindCompleted} />
          </PropertyList>
        </Section>
      )}

      <ConditionsSection conditions={status.conditions} />
    </>
  )
}
