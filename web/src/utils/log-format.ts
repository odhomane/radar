/**
 * Log formatting and display utilities.
 * Shared between LogsViewer and WorkloadLogsViewer components.
 */

/**
 * Format a K8s log timestamp for display.
 * Extracts and formats the time portion (HH:MM:SS).
 */
export function formatLogTimestamp(ts: string): string {
  try {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    // Fallback: extract HH:MM:SS from ISO timestamp
    return ts.slice(11, 19)
  }
}

/**
 * Determine the color class for a log line based on its content.
 * Detects common log level keywords.
 */
export function getLogLevelColor(content: string): string {
  const lower = content.toLowerCase()
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) {
    return 'text-red-400'
  }
  if (lower.includes('warn')) {
    return 'text-yellow-400'
  }
  if (lower.includes('debug') || lower.includes('trace')) {
    return 'text-theme-text-secondary'
  }
  return 'text-theme-text-primary'
}

/**
 * Highlight search query matches in text with a mark tag.
 * Returns HTML string safe for dangerouslySetInnerHTML.
 */
export function highlightSearchMatches(text: string, query: string): string {
  if (!query) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const escapedQuery = escapeHtml(query)
  const regex = new RegExp(`(${escapeRegExp(escapedQuery)})`, 'gi')
  return escaped.replace(regex, '<mark class="bg-yellow-500/30 text-yellow-200">$1</mark>')
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Escape special regex characters in a string.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Parse a K8s log line to extract timestamp and content.
 * K8s timestamps are in RFC3339Nano format: 2024-01-20T10:30:00.123456789Z content
 */
export function parseLogLine(line: string): { timestamp: string; content: string } {
  if (line.length > 30 && line[4] === '-' && line[7] === '-' && line[10] === 'T') {
    const spaceIdx = line.indexOf(' ')
    if (spaceIdx > 20 && spaceIdx < 40) {
      return { timestamp: line.slice(0, spaceIdx), content: line.slice(spaceIdx + 1) }
    }
  }
  return { timestamp: '', content: line }
}
