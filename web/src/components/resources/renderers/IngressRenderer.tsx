import { Globe, Shield, Clock, AlertTriangle } from 'lucide-react'
import { Section, PropertyList, Property } from '../drawer-components'

interface IngressRendererProps {
  data: any
}

export function IngressRenderer({ data }: IngressRendererProps) {
  const spec = data.spec || {}
  const rules = spec.rules || []
  const tls = spec.tls || []
  const lbIngress = data.status?.loadBalancer?.ingress || []

  // Check for issues
  const hasNoAddress = lbIngress.length === 0
  const hasNoClass = !spec.ingressClassName && !data.metadata?.annotations?.['kubernetes.io/ingress.class']
  const hasNoRules = rules.length === 0

  return (
    <>
      {/* No address warning */}
      {hasNoAddress && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-yellow-400">Address Not Assigned</div>
              <div className="text-xs text-yellow-300/80 mt-1">
                {hasNoClass
                  ? 'No ingress class specified — an ingress controller may not pick up this resource.'
                  : 'Waiting for ingress controller to provision address. Check Events if this persists.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No rules warning */}
      {hasNoRules && (
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-blue-400">No Routing Rules</div>
              <div className="text-xs text-blue-300/80 mt-1">
                This ingress has no rules defined. Traffic will not be routed.
              </div>
            </div>
          </div>
        </div>
      )}

      <Section title="Ingress" icon={Globe}>
        <PropertyList>
          <Property label="Class" value={spec.ingressClassName || data.metadata?.annotations?.['kubernetes.io/ingress.class']} />
          {lbIngress.length > 0 && (
            <Property label="Address" value={lbIngress[0].ip || lbIngress[0].hostname} />
          )}
          <Property label="TLS" value={tls.length > 0 ? `${tls.length} certificate(s)` : 'None'} />
        </PropertyList>
      </Section>

      <Section title="Rules" defaultExpanded>
        <div className="space-y-3">
          {rules.map((rule: any, i: number) => (
            <div key={i} className="bg-theme-elevated/30 rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                {tls.some((t: any) => t.hosts?.includes(rule.host)) && (
                  <Shield className="w-3.5 h-3.5 text-green-400" />
                )}
                <span className="text-sm font-medium text-theme-text-primary">{rule.host || '*'}</span>
              </div>
              <div className="space-y-1">
                {rule.http?.paths?.map((path: any) => (
                  <div key={path.path || '/'} className="text-xs text-theme-text-secondary flex items-center gap-2">
                    <span className="text-theme-text-tertiary">{path.pathType || 'Prefix'}:</span>
                    <span>{path.path || '/'}</span>
                    <span className="text-theme-text-tertiary">→</span>
                    <span className="text-blue-400">
                      {path.backend?.service?.name}:{path.backend?.service?.port?.number || path.backend?.service?.port?.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {tls.length > 0 && (
        <Section title="TLS" icon={Shield}>
          <div className="space-y-2">
            {tls.map((t: any) => (
              <div key={t.secretName} className="text-sm">
                <div className="text-theme-text-secondary">Secret: <span className="text-theme-text-primary">{t.secretName}</span></div>
                <div className="text-xs text-theme-text-tertiary">Hosts: {t.hosts?.join(', ') || '*'}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}
