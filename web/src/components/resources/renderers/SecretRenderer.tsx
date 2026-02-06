import { useState } from 'react'
import { AlertTriangle, Copy, Check } from 'lucide-react'
import { Section, PropertyList, Property } from '../drawer-components'

interface SecretRendererProps {
  data: any
}

export function SecretRenderer({ data }: SecretRendererProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const dataKeys = Object.keys(data.data || {})

  function toggleReveal(key: string) {
    setRevealed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function decodeBase64(value: string): string {
    try {
      return atob(value)
    } catch {
      return '[binary data]'
    }
  }

  async function copyValue(key: string, decodedValue: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(decodedValue)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <>
      <Section title="Secret">
        <PropertyList>
          <Property label="Type" value={data.type || 'Opaque'} />
          <Property label="Keys" value={String(dataKeys.length)} />
          {data.immutable && <Property label="Immutable" value="Yes" />}
        </PropertyList>
      </Section>

      <Section title="Data" defaultExpanded>
        <div className="space-y-2">
          {dataKeys.map((key) => {
            const decoded = decodeBase64(data.data[key])
            const isBinary = decoded === '[binary data]'

            return (
              <div key={key} className="bg-theme-elevated/30 rounded p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-theme-text-primary truncate">{key}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {revealed.has(key) && !isBinary && (
                      <button
                        onClick={() => copyValue(key, decoded)}
                        className="p-1 text-theme-text-tertiary hover:text-theme-text-primary transition-colors"
                        title="Copy value"
                      >
                        {copied === key ? (
                          <Check className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => toggleReveal(key)}
                      className="text-xs text-theme-text-secondary hover:text-theme-text-primary px-1.5 py-0.5 rounded hover:bg-theme-elevated transition-colors"
                    >
                      {revealed.has(key) ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                </div>
                {revealed.has(key) && (
                  <pre className="mt-2 bg-theme-base rounded p-2 text-xs text-theme-text-secondary overflow-x-auto max-h-40 whitespace-pre-wrap">
                    {decoded}
                  </pre>
                )}
              </div>
            )
          })}
          {dataKeys.length === 0 && (
            <div className="text-sm text-theme-text-tertiary">No data</div>
          )}
        </div>
      </Section>

      <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
        <AlertTriangle className="w-4 h-4" />
        Secret values are sensitive. Be careful when revealing.
      </div>
    </>
  )
}
