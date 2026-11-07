import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

type AuthStore = {
  country: string|null
  language: string|null
  resultUnit: string
  showForecast: boolean
  showForecastCone: boolean
  setCountry: (value: string) => void
  setLanguage: (value: string) => void
  setResultUnit: (value: string) => void
  setShowForecast: (value: boolean) => void
  setShowForecastCone: (value: boolean) => void
}

const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      country: null,
      language: null,
      resultUnit: 'mg/dL',
      showForecast: false,
      showForecastCone: true,
      setCountry: (value) => set(() => ({ country: value })),
      setLanguage: (value) => set(() => ({ language: value })),
      setResultUnit: (value) => set(() => ({ resultUnit: value })),
      setShowForecast: (value) => set((s) => ({ showForecast: value, showForecastCone: value ? true : s.showForecastCone })),
      setShowForecastCone: (value) => set(() => ({ showForecastCone: value })),
    }), {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
    },
  )
)

export {
  useAuthStore
}
