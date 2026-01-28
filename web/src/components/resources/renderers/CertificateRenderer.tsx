import { Shield, AlertTriangle, Clock, Globe } from 'lucide-react'
import { clsx } from 'clsx'
import { Section, PropertyList, Property, ConditionsSection } from '../drawer-components'

interface CertificateRendererProps {
  data: any
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function getDaysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime()
  const now = Date.now()
  return Math.floor((target - now) / (1000 * 60 * 60 * 24))
}

export function CertificateRenderer({ data }: CertificateRendererProps) {
  const spec = data.spec || {}
  const status = data.status || {}
  const conditions = status.conditions || []
  const dnsNames = spec.dnsNames || []
  const issuerRef = spec.issuerRef || {}
  const usages = spec.usages || []

  const readyCond = conditions.find((c: any) => c.type === 'Ready')
  const isReady = readyCond?.status === 'True'
  const isNotReady = readyCond?.status === 'False'

  const notAfter = status.notAfter
  const notBefore = status.notBefore
  const renewalTime = status.renewalTime

  const daysUntilExpiry = notAfter ? getDaysUntil(notAfter) : null
  const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0
  const expiresWithin7Days = daysUntilExpiry !== null && !isExpired && daysUntilExpiry <= 7
  const expiresWithin30Days = daysUntilExpiry !== null && !isExpired && !expiresWithin7Days && daysUntilExpiry <= 30

  // Progress bar calculation
  let progressPct = 0
  let progressColor = 'bg-green-500'
  if (notBefore && notAfter) {
    const now = Date.now()
    const start = new Date(notBefore).getTime()
    const end = new Date(notAfter).getTime()
    progressPct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))
    if (progressPct >= 90) {
      progressColor = 'bg-red-500'
    } else if (progressPct >= 70) {
      progressColor = 'bg-yellow-500'
    }
  }

  // Expiry remaining text color
  const expiryTextColor = isExpired || expiresWithin7Days
    ? 'text-red-400'
    : expiresWithin30Days
      ? 'text-yellow-400'
      : 'text-green-400'

  return (
    <>
      {/* Problem detection alerts */}
      {isNotReady && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-400">Certificate Not Ready</div>
              <div className="text-xs text-red-300/80 mt-1">
                {readyCond.reason && <span className="font-medium">{readyCond.reason}: </span>}
                {readyCond.message || 'The certificate is not in a ready state.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {isExpired && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-400">Certificate has expired</div>
              <div className="text-xs text-red-300/80 mt-1">
                Expired {formatDate(notAfter)}. Renewal may be pending or failing.
              </div>
            </div>
          </div>
        </div>
      )}

      {expiresWithin7Days && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-400">
                Certificate expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-red-300/80 mt-1">
                Check that cert-manager is renewing this certificate.
              </div>
            </div>
          </div>
        </div>
      )}

      {expiresWithin30Days && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-yellow-400">
                Certificate expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-yellow-300/80 mt-1">
                Renewal should happen automatically before expiry.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Certificate Info */}
      <Section title="Certificate Info" icon={Shield}>
        <PropertyList>
          <Property
            label="Status"
            value={
              <span className={clsx(
                'px-2 py-0.5 rounded text-xs font-medium',
                isReady
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              )}>
                {isReady ? 'Ready' : 'Not Ready'}
              </span>
            }
          />
          <Property label="Secret Name" value={spec.secretName} />
          <Property label="Revision" value={status.revision} />
        </PropertyList>
      </Section>

      {/* Validity */}
      <Section title="Validity" icon={Clock}>
        <PropertyList>
          <Property label="Not Before" value={notBefore ? formatDate(notBefore) : '-'} />
          <Property
            label="Not After"
            value={
              notAfter ? (
                <span>
                  {formatDate(notAfter)}
                  {daysUntilExpiry !== null && (
                    <span className={clsx('ml-2 text-xs', expiryTextColor)}>
                      {isExpired
                        ? `(expired ${-daysUntilExpiry}d ago)`
                        : `(${daysUntilExpiry}d remaining)`}
                    </span>
                  )}
                </span>
              ) : '-'
            }
          />
          <Property label="Renewal Time" value={renewalTime ? formatDate(renewalTime) : '-'} />
        </PropertyList>

        {/* Progress bar */}
        {notBefore && notAfter && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-theme-text-tertiary mb-1">
              <span>{formatDate(notBefore)}</span>
              <span>{formatDate(notAfter)}</span>
            </div>
            <div className="h-2 bg-theme-hover rounded overflow-hidden">
              <div
                className={clsx('h-full transition-all', progressColor)}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-xs text-theme-text-tertiary mt-1 text-center">
              {Math.round(progressPct)}% elapsed
            </div>
          </div>
        )}
      </Section>

      {/* Domains */}
      {dnsNames.length > 0 && (
        <Section title="Domains" icon={Globe}>
          <div className="flex flex-wrap gap-1">
            {dnsNames.map((name: string) => (
              <span
                key={name}
                className="px-2 py-0.5 bg-theme-elevated rounded text-xs text-theme-text-secondary"
              >
                {name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Issuer */}
      <Section title="Issuer">
        <PropertyList>
          <Property label="Kind" value={issuerRef.kind} />
          <Property label="Name" value={issuerRef.name} />
          <Property label="Group" value={issuerRef.group} />
        </PropertyList>
      </Section>

      {/* Usages */}
      {usages.length > 0 && (
        <Section title="Usages">
          <div className="flex flex-wrap gap-1">
            {usages.map((usage: string) => (
              <span
                key={usage}
                className="px-2 py-0.5 bg-theme-elevated rounded text-xs text-theme-text-secondary"
              >
                {usage}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Conditions */}
      <ConditionsSection conditions={conditions} />
    </>
  )
}
