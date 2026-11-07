import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useAuthStore } from './auth'

/** Per-patient overrides of the global forecast settings; a missing key means "use global". */
export type ForecastOverride = { showForecast?: boolean; showForecastCone?: boolean }

type ForecastStore = {
  overrides: Record<string, ForecastOverride>
  setOverride: (patientId: string, patch: ForecastOverride) => void
  /** Turns the forecast on/off for one patient; enabling it switches the cone on too. */
  setForecast: (patientId: string, value: boolean | undefined) => void
  setCone: (patientId: string, value: boolean | undefined) => void
}

const clean = (o: ForecastOverride): ForecastOverride =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

const useForecastStore = create<ForecastStore>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (patientId, patch) =>
        set((s) => ({ overrides: { ...s.overrides, [patientId]: clean({ ...s.overrides[patientId], ...patch }) } })),
      setForecast: (patientId, value) =>
        set((s) => ({
          overrides: {
            ...s.overrides,
            [patientId]: clean({
              ...s.overrides[patientId],
              showForecast: value,
              ...(value ? { showForecastCone: true } : {}),
            }),
          },
        })),
      setCone: (patientId, value) =>
        set((s) => ({ overrides: { ...s.overrides, [patientId]: clean({ ...s.overrides[patientId], showForecastCone: value }) } })),
    }),
    { name: 'forecast-overrides', storage: createJSONStorage(() => localStorage) },
  ),
)

/** Effective forecast settings for a patient: its override, else the global value. */
function useForecastSettings(patientId?: string) {
  const globalForecast = useAuthStore((s) => s.showForecast)
  const globalCone = useAuthStore((s) => s.showForecastCone)
  const override = useForecastStore((s) => (patientId ? s.overrides[patientId] : undefined))
  return {
    showForecast: override?.showForecast ?? globalForecast,
    showForecastCone: override?.showForecastCone ?? globalCone,
    override,
  }
}

export { useForecastStore, useForecastSettings }
