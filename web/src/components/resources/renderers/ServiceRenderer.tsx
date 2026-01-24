import { Globe, AlertTriangle, Clock } from 'lucide-react'
import { Section, PropertyList, Property, KeyValueBadgeList, CopyHandler } from '../drawer-components'
import { PortForwardInlineButton } from '../../portforward/PortForwardButton'

interface ServiceRendererProps {
  data: any
  onCopy: CopyHandler
  copied: string | null
}

export function ServiceRenderer({ data, onCopy, copied }: ServiceRendererProps) {
  const spec = data.spec || {}
  const ports = spec.ports || []
  const lbIngress = data.status?.loadBalancer?.ingress || []
  const namespace = data.metadata?.namespace
  const serviceName = data.metadata?.name

  // Check for issues
  const isLoadBalancer = spec.type === 'LoadBalancer'
  const lbPending = isLoadBalancer && lbIngress.length === 0
  const hasNoSelector = !spec.selector || Object.keys(spec.selector).length === 0
  const isExternalName = spec.type === 'ExternalName'

  return (
    <>
      {/* LoadBalancer pending warning */}
      {lbPending && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-yellow-400">Load Balancer Pending</div>
              <div className="text-xs text-yellow-300/80 mt-1">
                External IP/hostname has not been assigned yet. This may take a few minutes.
                Check Events below if provisioning is stuck.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No selector warning (manual endpoints) */}
      {hasNoSelector && !isExternalName && (
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-blue-400">No Pod Selector</div>
              <div className="text-xs text-blue-300/80 mt-1">
                This service has no selector — endpoints must be managed manually or by an external controller.
              </div>
            </div>
          </div>
        </div>
      )}

      <Section title="Service" icon={Globe}>
        <PropertyList>
          <Property label="Type" value={spec.type || 'ClusterIP'} />
          <Property label="Cluster IP" value={spec.clusterIP} copyable onCopy={onCopy} copied={copied} />
          {spec.externalIPs?.length > 0 && (
            <Property label="External IPs" value={spec.externalIPs.join(', ')} copyable onCopy={onCopy} copied={copied} />
          )}
          {lbIngress.length > 0 && (
            <Property
              label="Load Balancer"
              value={lbIngress[0].ip || lbIngress[0].hostname}
              copyable
              onCopy={onCopy}
              copied={copied}
            />
          )}
          <Property label="Session Affinity" value={spec.sessionAffinity} />
          <Property label="External Traffic" value={spec.externalTrafficPolicy} />
        </PropertyList>
      </Section>

      <Section title="Ports" defaultExpanded>
        <div className="space-y-2">
          {ports.map((port: any, i: number) => (
            <div key={`${port.port}-${port.protocol || 'TCP'}`} className="bg-theme-elevated/30 rounded p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-theme-text-primary font-medium">{port.name || `port-${i + 1}`}</span>
                <div className="flex items-center gap-2">
                  <PortForwardInlineButton
                    namespace={namespace}
                    serviceName={serviceName}
                    port={port.port}
                    protocol={port.protocol || 'TCP'}
                  />
                </div>
              </div>
              <div className="text-xs text-theme-text-secondary mt-1">
                {port.port} {port.targetPort !== port.port && `→ ${port.targetPort}`}
                {port.nodePort && ` (NodePort: ${port.nodePort})`}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {spec.selector && (
        <Section title="Selector">
          <KeyValueBadgeList items={spec.selector} />
        </Section>
      )}
    </>
  )
}
