import { useState } from 'react'
import { EventsTimeline } from './EventsTimeline'
import { TimelineSwimlanes } from './TimelineSwimlanes'
import { useChanges, useTopology } from '../../api/client'
import type { TimeRange } from '../../types'

interface EventsViewProps {
  namespace: string
  onResourceClick?: (kind: string, namespace: string, name: string) => void
}

export type EventsViewMode = 'list' | 'swimlane'

export function EventsView({ namespace, onResourceClick }: EventsViewProps) {
  const [viewMode, setViewMode] = useState<EventsViewMode>('swimlane')
  const [timeRange] = useState<TimeRange>('1h')

  // Fetch events for swimlane view (shared with timeline)
  const { data: events, isLoading } = useChanges({
    namespace: namespace || undefined,
    timeRange,
    includeK8sEvents: true,
    includeManaged: true, // Include Pods, ReplicaSets, etc. for hierarchical view
    limit: 1000,
  })

  // Fetch topology for service stack grouping
  const { data: topology } = useTopology(namespace, 'resources')

  if (viewMode === 'swimlane') {
    return (
      <TimelineSwimlanes
        events={events || []}
        isLoading={isLoading}
        filterTimeRange={timeRange}
        onResourceClick={onResourceClick}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        topology={topology}
      />
    )
  }

  return (
    <EventsTimeline
      namespace={namespace}
      currentView={viewMode}
      onViewChange={setViewMode}
      onResourceClick={onResourceClick}
    />
  )
}

// ViewToggle component - temporarily unused while events view is being reworked
// interface ViewToggleProps {
//   viewMode: EventsViewMode
//   onChange: (mode: EventsViewMode) => void
// }
// function ViewToggle({ viewMode, onChange }: ViewToggleProps) { ... }
