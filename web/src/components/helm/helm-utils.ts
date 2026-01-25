// Utility functions for Helm components

import { getHelmStatusColor } from '../../utils/badge-colors'
// Re-export formatAge from resource-utils to avoid duplication
export { formatAge } from '../resources/resource-utils'

// Get status color classes for Helm release status
// Delegates to centralized badge-colors for consistency
export function getStatusColor(status: string): string {
  return getHelmStatusColor(status)
}

// Format date for display
export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Truncate text with ellipsis
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

// Get chart display name (combines chart name and version)
export function getChartDisplay(chart: string, version: string): string {
  return `${chart}-${version}`
}

// Map resource kind to plural name for API calls
export function kindToPlural(kind: string): string {
  const kindLower = kind.toLowerCase()
  const irregulars: Record<string, string> = {
    ingress: 'ingresses',
    configmap: 'configmaps',
    service: 'services',
    deployment: 'deployments',
    statefulset: 'statefulsets',
    daemonset: 'daemonsets',
    replicaset: 'replicasets',
    pod: 'pods',
    secret: 'secrets',
    serviceaccount: 'serviceaccounts',
    persistentvolumeclaim: 'persistentvolumeclaims',
    role: 'roles',
    rolebinding: 'rolebindings',
    clusterrole: 'clusterroles',
    clusterrolebinding: 'clusterrolebindings',
    networkpolicy: 'networkpolicies',
    horizontalpodautoscaler: 'horizontalpodautoscalers',
    poddisruptionbudget: 'poddisruptionbudgets',
    job: 'jobs',
    cronjob: 'cronjobs',
  }
  return irregulars[kindLower] || kindLower + 's'
}
