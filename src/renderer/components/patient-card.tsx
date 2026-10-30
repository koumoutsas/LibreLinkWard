import type { PatientState } from '../../shared/stores'
import { TrendArrow } from '@/components/ui/trend-arrow'
import { PatientGraph } from '@/components/patient-graph'
import { useAlarmConfig } from '@/hooks/useAlarmConfig'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'
import { DEFAULT_SIGNAL_LOSS_MINUTES, isStale, lastSeenAt } from '../../shared/alarms/staleness'
import { useNow } from '@/hooks/useNow'
import { LEVEL_CLASS, formatGlucose, glucoseLevel, minutesSince } from '@/lib/glucose'

const GRAPH_WINDOW_MS = 6 * 60 * 60 * 1000

type Props = { patient: PatientState; now?: number; onOpen: (patientId: string) => void }

export function PatientCard({ patient, now: nowProp, onOpen }: Props) {
  const ticking = useNow()
  const now = nowProp ?? ticking
  const unit = useAuthStore((s) => s.resultUnit)
  const showForecast = useAuthStore((s) => s.showForecast)
  const showForecastCone = useAuthStore((s) => s.showForecastCone)
  const { config } = useAlarmConfig(patient.patientId)
  const mgdl = patient.latest?.ValueInMgPerDl
  const stale = isStale(patient.latest, patient.lastUpdated, config?.signalLossMinutes ?? DEFAULT_SIGNAL_LOSS_MINUTES, now)
  const level = mgdl !== undefined && config && !stale ? glucoseLevel(mgdl, config) : undefined
  const age = minutesSince(lastSeenAt(patient.latest, patient.lastUpdated), now)

  return (
    <button
      type="button"
      data-testid={`patient-card-${patient.patientId}`}
      onClick={() => onOpen(patient.patientId)}
      className="flex flex-col rounded-lg border text-left overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className={cn('flex items-center justify-between px-4 py-3 text-white', level ? LEVEL_CLASS[level] : 'bg-gray-500')}>
        <span className="font-semibold truncate">{patient.name}</span>
        <span className="flex items-center gap-2 text-2xl font-semibold">
          {stale ? '--' : formatGlucose(mgdl, unit)}
          <span className="text-xs font-normal">{unit}</span>
          {patient.latest && !stale && <TrendArrow className="h-5 w-5" trend={patient.latest.TrendArrow ?? 3} />}
        </span>
      </div>
      <div className="px-2 pt-1 text-foreground/70">
        <PatientGraph
          history={patient.history}
          unit={unit}
          targetLow={config?.low ?? patient.targetLow ?? 70}
          targetHigh={config?.high ?? patient.targetHigh ?? 180}
          windowMs={GRAPH_WINDOW_MS}
          height={200}
          forecast={showForecast}
          forecastCone={showForecastCone}
        />
      </div>
      <div className="flex justify-between px-4 pb-2 text-xs text-muted-foreground">
        <span>{age === undefined ? 'No data yet' : `${age} min ago`}</span>
        {patient.status === 'error' && (
          <span className="text-red-600" title={patient.lastError}>
            Connection problem
          </span>
        )}
      </div>
    </button>
  )
}
