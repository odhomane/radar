import { XCircle, RefreshCw, Loader2 } from 'lucide-react'
import type { ConnectionState } from '../context/ConnectionContext'
import { ContextSwitcher } from './ContextSwitcher'

interface ConnectionErrorViewProps {
  connection: ConnectionState
  onRetry: () => void
  isRetrying: boolean
}

const errorHints: Record<string, { title: string; hints: string[] }> = {
  auth: {
    title: 'Authentication Failed',
    hints: [
      'Your credentials may have expired',
      'For GKE: gcloud container clusters get-credentials <cluster> --region <region>',
      'For EKS: aws eks update-kubeconfig --name <cluster> --region <region>',
      'For AKS: az aks get-credentials --name <cluster> --resource-group <rg>',
    ],
  },
  network: {
    title: 'Network Unreachable',
    hints: [
      'The cluster may be unreachable from your network',
      'Check if VPN connection is required',
      'Verify firewall rules allow access',
      'Confirm the cluster is running',
    ],
  },
  timeout: {
    title: 'Connection Timed Out',
    hints: [
      'The cluster is taking too long to respond',
      'The cluster may be under heavy load',
      'Network latency may be too high',
      'Try again or check cluster health',
    ],
  },
  unknown: {
    title: 'Connection Failed',
    hints: [
      'Check your kubeconfig is valid',
      'Verify the cluster endpoint is correct',
      'Try switching to a different context',
    ],
  },
}

export function ConnectionErrorView({ connection, onRetry, isRetrying }: ConnectionErrorViewProps) {
  const errorInfo = errorHints[connection.errorType || 'unknown'] || errorHints.unknown

  return (
    <div className="flex-1 flex items-start justify-center pt-16 px-8">
      <div className="max-w-lg w-full">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
            <XCircle className="w-10 h-10 text-red-400" />
          </div>

          <h2 className="text-xl font-semibold text-theme-text-primary mb-2">
            Cannot Connect to Cluster
          </h2>

          <p className="text-sm text-theme-text-secondary mb-1">
            Context: <span className="font-mono text-theme-text-primary">{connection.context || '(none)'}</span>
          </p>

          {connection.clusterName && (
            <p className="text-sm text-theme-text-secondary mb-4">
              Cluster: <span className="font-mono text-theme-text-primary">{connection.clusterName}</span>
            </p>
          )}

          <div className="w-full bg-theme-surface border border-theme-border rounded-lg p-4 mb-6 text-left">
            <h3 className="text-sm font-medium text-theme-text-primary mb-2">
              {errorInfo.title}
            </h3>
            <ul className="text-sm text-theme-text-secondary space-y-1">
              {errorInfo.hints.map((hint, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-theme-text-tertiary mt-0.5">-</span>
                  <span>{hint}</span>
                </li>
              ))}
            </ul>
          </div>

          {connection.error && (
            <div className="w-full bg-theme-elevated border border-theme-border rounded-lg p-3 mb-6 overflow-auto max-h-32">
              <code className="text-xs text-red-400 font-mono whitespace-pre-wrap break-all">
                {connection.error}
              </code>
            </div>
          )}

          <div className="flex items-center gap-5">
            <button
              onClick={onRetry}
              disabled={isRetrying}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white rounded-lg transition-colors"
            >
              {isRetrying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Retry Connection
                </>
              )}
            </button>

            <ContextSwitcher />
          </div>
        </div>
      </div>
    </div>
  )
}
