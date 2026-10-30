import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

type AuthStore = {
  token: string|null
  accountId: string|null
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
  login: (token: string, country: string, language: string, accountId: string) => void
  logout: () => void
}

const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      accountId: null,
      country: null,
      language: null,
      resultUnit: 'mg/dL',
      showForecast: false,
      showForecastCone: false,
      login: (token: string, country: string, language: string, accountId: string) => set(() => ({ token, country, language, accountId })),
      logout: () => set(() => ({ token: null })),
      setCountry: (value) => set(() => ({ country: value })),
      setLanguage: (value) => set(() => ({ language: value })),
      setResultUnit: (value) => set(() => ({ resultUnit: value })),
      setShowForecast: (value) => set(() => ({ showForecast: value })),
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
