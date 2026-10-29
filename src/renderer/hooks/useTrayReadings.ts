import { useEffect } from 'react'
import { usePatients } from '@/hooks/usePatients'
import { useAuthStore } from '@/stores/auth'
import { useActiveAlarms } from '@/hooks/useActiveAlarms'
import { updateTrayReadings } from '@/lib/utils'

/** Keeps the system tray in step with the latest reading of every patient. */
export function useTrayReadings() {
  const { patients } = usePatients()
  const unit = useAuthStore((s) => s.resultUnit)
  // The alarm engine decides when a patient has stopped transmitting.
  const { alarms } = useActiveAlarms()
  const stale = new Set(alarms.filter((a) => a.kind === 'signal-loss').map((a) => a.patientId))

  const readings = patients.flatMap((p) =>
    p.latest ? [{ name: p.name, mgdl: p.latest.ValueInMgPerDl, targetLow: p.targetLow, targetHigh: p.targetHigh, trend: p.latest.TrendArrow ?? 3, stale: stale.has(p.patientId) }] : [],
  )
  const key = JSON.stringify(readings)

  useEffect(() => {
    updateTrayReadings(readings)
  }, [key, unit])
}
