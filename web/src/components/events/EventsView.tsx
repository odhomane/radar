import { useState } from 'react'
import { List, GanttChart } from 'lucide-react'
import { EventsTimeline } from './EventsTimeline'
import { TimelineSwimlanes } from './TimelineSwimlanes'
import { useChanges } from '../../api/client'
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

  if (viewMode === 'swimlane') {
    return (
      <div className="flex flex-col h-full w-full">
        {/* Header with view toggle */}
        <div className="flex items-center justify-end px-4 py-2 border-b border-slate-700 bg-slate-800/50">
          <ViewToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
        <TimelineSwimlanes
          events={events || []}
          isLoading={isLoading}
          filterTimeRange={timeRange}
          onResourceClick={onResourceClick}
        />
      </div>
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

interface ViewToggleProps {
  viewMode: EventsViewMode
  onChange: (mode: EventsViewMode) => void
}

function ViewToggle({ viewMode, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
      <button
        onClick={() => onChange('list')}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
          viewMode === 'list' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        <List className="w-4 h-4" />
        List
      </button>
      <button
        onClick={() => onChange('swimlane')}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
          viewMode === 'swimlane' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        <GanttChart className="w-4 h-4" />
        Timeline
      </button>
    </div>
  )
}
