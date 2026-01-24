import { Clock, AlertTriangle, Pause } from 'lucide-react'
import { Section, PropertyList, Property } from '../drawer-components'
import { formatAge, cronToHuman } from '../resource-utils'

interface CronJobRendererProps {
  data: any
}

export function CronJobRenderer({ data }: CronJobRendererProps) {
  const status = data.status || {}
  const spec = data.spec || {}

  // Check for issues or notable states
  const isSuspended = spec.suspend === true
  const hasNeverRun = !status.lastScheduleTime

  // Calculate time since last success vs last schedule
  const lastScheduleAge = status.lastScheduleTime ? new Date().getTime() - new Date(status.lastScheduleTime).getTime() : 0
  const lastSuccessAge = status.lastSuccessfulTime ? new Date().getTime() - new Date(status.lastSuccessfulTime).getTime() : 0
  const recentFailures = lastScheduleAge > 0 && lastSuccessAge > lastScheduleAge

  return (
    <>
      {/* Suspended warning */}
      {isSuspended && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <Pause className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-yellow-400">CronJob Suspended</div>
              <div className="text-xs text-yellow-300/80 mt-1">
                No new jobs will be scheduled until this CronJob is resumed.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Never run warning */}
      {hasNeverRun && !isSuspended && (
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-blue-400">Never Scheduled</div>
              <div className="text-xs text-blue-300/80 mt-1">
                This CronJob has never run. Check the schedule and starting deadline settings.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent failures warning */}
      {recentFailures && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-400">Recent Jobs Failing</div>
              <div className="text-xs text-red-300/80 mt-1">
                Jobs have been scheduled but haven't succeeded recently.
                Last success: {formatAge(status.lastSuccessfulTime)}.
                Check job history and pod logs.
              </div>
            </div>
          </div>
        </div>
      )}

      <Section title="Schedule" icon={Clock}>
        <PropertyList>
          <Property label="Schedule" value={spec.schedule} />
          <Property label="Human" value={cronToHuman(spec.schedule)} />
          <Property label="Suspend" value={spec.suspend ? 'Yes' : 'No'} />
          <Property label="Last Schedule" value={status.lastScheduleTime ? formatAge(status.lastScheduleTime) : 'Never'} />
          <Property label="Last Success" value={status.lastSuccessfulTime ? formatAge(status.lastSuccessfulTime) : 'Never'} />
          <Property label="Active Jobs" value={status.active?.length || 0} />
        </PropertyList>
      </Section>

      <Section title="Configuration">
        <PropertyList>
          <Property label="Concurrency" value={spec.concurrencyPolicy || 'Allow'} />
          <Property label="Starting Deadline" value={spec.startingDeadlineSeconds ? `${spec.startingDeadlineSeconds}s` : 'None'} />
          <Property label="Success History" value={spec.successfulJobsHistoryLimit ?? 3} />
          <Property label="Failed History" value={spec.failedJobsHistoryLimit ?? 1} />
        </PropertyList>
      </Section>

      {status.active?.length > 0 && (
        <Section title="Active Jobs">
          <div className="space-y-1">
            {status.active.map((job: any) => (
              <div key={job.name} className="text-sm text-blue-400">{job.name}</div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}
