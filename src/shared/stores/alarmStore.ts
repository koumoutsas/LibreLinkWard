import { createStore } from 'zustand/vanilla'

export type AlarmConfig = {
  enabled: boolean
  urgentLow: number
  low: number
  high: number
  urgentHigh: number
  /** Raise a no-data alarm when no reading arrived for this long. */
  signalLossMinutes: number
  sound: boolean
}

export type Targets = { targetLow?: number; targetHigh?: number }

// mg/dL, used when the sensor reports no target range.
export const FALLBACK_DEFAULTS = {
  urgentLow: 55,
  low: 70,
  high: 180,
  urgentHigh: 250,
}

/** Defaults follow the sensor's own target range when available. */
export function defaultAlarmConfig(targets: Targets = {}): AlarmConfig {
  return {
    enabled: false,
    ...FALLBACK_DEFAULTS,
    low: targets.targetLow ?? FALLBACK_DEFAULTS.low,
    high: targets.targetHigh ?? FALLBACK_DEFAULTS.high,
    signalLossMinutes: 20,
    sound: false,
  }
}

export type AlarmStoreState = {
  /** Only user changes are stored, so defaults keep tracking sensor targets. */
  overrides: Record<string, Partial<AlarmConfig>>
  /** Epoch ms until which a patient's alarms are snoozed. Not persisted. */
  snoozedUntil: Record<string, number>
  setConfig: (patientId: string, patch: Partial<AlarmConfig>) => void
  resetConfig: (patientId: string) => void
  snooze: (patientId: string, until: number) => void
  clearSnooze: (patientId: string) => void
}

export const createAlarmStore = (
  initial: Pick<AlarmStoreState, 'overrides'> = { overrides: {} },
) =>
  createStore<AlarmStoreState>()((set) => ({
    overrides: initial.overrides,
    snoozedUntil: {},
    setConfig: (patientId, patch) =>
      set((s) => ({
        overrides: {
          ...s.overrides,
          [patientId]: { ...s.overrides[patientId], ...patch },
        },
      })),
    resetConfig: (patientId) =>
      set((s) => {
        const { [patientId]: _removed, ...overrides } = s.overrides
        return { overrides }
      }),
    snooze: (patientId, until) =>
      set((s) => ({ snoozedUntil: { ...s.snoozedUntil, [patientId]: until } })),
    clearSnooze: (patientId) =>
      set((s) => {
        const { [patientId]: _removed, ...snoozedUntil } = s.snoozedUntil
        return { snoozedUntil }
      }),
  }))

export type AlarmStore = ReturnType<typeof createAlarmStore>

export const resolveAlarmConfig = (
  state: Pick<AlarmStoreState, 'overrides'>,
  patientId: string,
  targets: Targets = {},
): AlarmConfig => ({
  ...defaultAlarmConfig(targets),
  ...state.overrides[patientId],
})

export const isSnoozed = (
  state: Pick<AlarmStoreState, 'snoozedUntil'>,
  patientId: string,
  now = Date.now(),
): boolean => (state.snoozedUntil[patientId] ?? 0) > now
