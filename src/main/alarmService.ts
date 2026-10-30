import {
  AlarmEngineState,
  AlarmEvent,
  AlarmKind,
  acknowledge,
  evaluateAlarms,
} from '../shared/alarms'
import {
  AlarmStore,
  PatientStore,
  isSnoozed,
  resolveAlarmConfig,
} from '../shared/stores'

export type ActiveAlarm = {
  patientId: string
  name: string
  kind: AlarmKind
  /** mg/dL, absent for signal loss. */
  value?: number
  since: number
  acknowledged: boolean
}

export type AlarmNotification = {
  patientId: string
  name: string
  kind: AlarmKind
  type: AlarmEvent['type']
  value?: number
  /** Whether the user enabled sound for this patient. */
  sound: boolean
}

export type AlarmServiceDeps = {
  patients: PatientStore
  alarms: AlarmStore
  onActive: (alarms: ActiveAlarm[]) => void
  onNotify: (notification: AlarmNotification) => void
  now?: () => number
  /** Re-evaluation period; signal loss and repeats need time to pass without new data. */
  tickMs?: number
}

/**
 * Runs the pure alarm engine for every patient on store changes and on a
 * timer, and reports active alarms and notifications.
 */
export class AlarmService {
  private states = new Map<string, AlarmEngineState>()
  private lastActiveJson = '[]'
  private timer?: ReturnType<typeof setInterval>
  private unsubscribe: Array<() => void> = []
  private readonly now: () => number

  constructor(private readonly deps: AlarmServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  start() {
    this.unsubscribe = [
      this.deps.patients.subscribe(() => this.evaluate()),
      // Snooze/config changes take effect immediately.
      this.deps.alarms.subscribe(() => this.evaluate()),
    ]
    this.timer = setInterval(() => this.evaluate(), this.deps.tickMs ?? 30_000)
    this.evaluate()
  }

  stop() {
    this.unsubscribe.forEach((u) => u())
    this.unsubscribe = []
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  getActive(): ActiveAlarm[] {
    const { patients } = this.deps.patients.getState()
    const active: ActiveAlarm[] = []
    for (const [patientId, state] of this.states) {
      const patient = patients[patientId]
      if (!state.active || !patient) continue
      active.push({
        patientId,
        name: patient.name,
        kind: state.active,
        value: state.active === 'signal-loss' ? undefined : patient.latest?.ValueInMgPerDl,
        since: state.since ?? 0,
        acknowledged: !!state.acknowledged,
      })
    }
    return active.sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || a.since - b.since)
  }

  /** Silences repeats for the current alarm; a new or worse alarm notifies again. */
  acknowledge(patientId: string) {
    const state = this.states.get(patientId)
    if (state) this.states.set(patientId, acknowledge(state))
    this.publish()
  }

  snooze(patientId: string, minutes: number) {
    this.deps.alarms.getState().snooze(patientId, this.now() + minutes * 60_000)
  }

  clearSnooze(patientId: string) {
    this.deps.alarms.getState().clearSnooze(patientId)
  }

  evaluate() {
    const now = this.now()
    const patients = this.deps.patients.getState().patients
    const alarmState = this.deps.alarms.getState()

    for (const id of [...this.states.keys()]) {
      if (!patients[id]) this.states.delete(id)
    }
    for (const patient of Object.values(patients)) {
      const config = resolveAlarmConfig(alarmState, patient.patientId, patient)
      const { state, events } = evaluateAlarms(
        {
          latest: patient.latest,
          history: config.predictive ? patient.history : undefined,
          lastUpdated: patient.lastUpdated,
          config,
          now,
          snoozed: isSnoozed(alarmState, patient.patientId, now),
        },
        this.states.get(patient.patientId),
      )
      this.states.set(patient.patientId, state)
      for (const e of events) {
        if (e.type === 'clear') continue
        this.deps.onNotify({
          patientId: patient.patientId,
          name: patient.name,
          kind: e.kind,
          type: e.type,
          value: e.value,
          sound: config.sound,
        })
      }
    }
    this.publish()
  }

  private publish() {
    const active = this.getActive()
    const json = JSON.stringify(active)
    if (json === this.lastActiveJson) return
    this.lastActiveJson = json
    this.deps.onActive(active)
  }
}
