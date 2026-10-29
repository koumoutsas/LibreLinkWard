import { useEffect } from 'react'
import { usePatients } from '@/hooks/usePatients'
import { useAuthStore } from '@/stores/auth'
import { updateTrayReadings } from '@/lib/utils'

/** Keeps the system tray in step with the latest reading of every patient. */
export function useTrayReadings() {
  const { patients } = usePatients()
  const unit = useAuthStore((s) => s.resultUnit)

  const readings = patients.flatMap((p) =>
    p.latest ? [{ name: p.name, mgdl: p.latest.ValueInMgPerDl, targetLow: p.targetLow, targetHigh: p.targetHigh }] : [],
  )
  const key = JSON.stringify(readings)

  useEffect(() => {
    updateTrayReadings(readings)
  }, [key, unit])
}
