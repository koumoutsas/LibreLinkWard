import type { AlarmKind } from '../../shared/alarms'
import { formatGlucose } from './glucose'

const LABEL: Record<AlarmKind, string> = {
  'urgent-low': 'Urgent low',
  low: 'Low',
  high: 'High',
  'urgent-high': 'Urgent high',
  'signal-loss': 'No data',
}

export const alarmLabel = (kind: AlarmKind): string => LABEL[kind]

/** e.g. "Urgent low: 52 mg/dL" or "No data". */
export const describeAlarm = (kind: AlarmKind, mgdl: number | undefined, unit: string): string =>
  kind === 'signal-loss' || mgdl === undefined
    ? LABEL[kind]
    : `${LABEL[kind]}: ${formatGlucose(mgdl, unit)} ${unit}`
