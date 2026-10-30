import { useEffect, useState } from 'react'
import { usePatients } from '@/hooks/usePatients'
import { useAuthStore } from '@/stores/auth'
import { useActiveAlarms } from '@/hooks/useActiveAlarms'
import { updateTrayReadings } from '@/lib/utils'
import { DEFAULT_SIGNAL_LOSS_MINUTES, isStale } from '../../shared/alarms/staleness'

const TICK_MS = 30_000

/** Keeps the system tray in step with the latest reading of every patient. */
export function useTrayReadings() {
  const { patients } = usePatients()
  const unit = useAuthStore((s) => s.resultUnit)
  const { alarms } = useActiveAlarms()
  const [now, setNow] = useState(Date.now())
  const [timeouts, setTimeouts] = useState<Record<string, number>>({})

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const ids = patients.map((p) => p.patientId).join(',')
  useEffect(() => {
    const { ipcRenderer } = window.electron
    let active = true
    const load = async () => {
      const entries = await Promise.all(
        patients.map(async (p) => [p.patientId, (await ipcRenderer.invoke('alarms:get', p.patientId))?.signalLossMinutes] as const),
      )
      if (active) setTimeouts(Object.fromEntries(entries.filter(([, m]) => typeof m === 'number')))
    }
    load()
    const off = ipcRenderer.on('alarms:changed', () => {
      load()
    })
    return () => {
      active = false
      off?.()
    }
  }, [ids])

  // Stale by age, whether or not the signal-loss alarm is enabled; the alarm engine also counts.
  const alarmed = new Set(alarms.filter((a) => a.kind === 'signal-loss').map((a) => a.patientId))
  const stale = (p: (typeof patients)[number]) =>
    alarmed.has(p.patientId) || isStale(p.latest, p.lastUpdated, timeouts[p.patientId] ?? DEFAULT_SIGNAL_LOSS_MINUTES, now)

  const readings = patients.flatMap((p) =>
    p.latest ? [{ name: p.name, mgdl: p.latest.ValueInMgPerDl, targetLow: p.targetLow, targetHigh: p.targetHigh, trend: p.latest.TrendArrow ?? 3, stale: stale(p) }] : [],
  )
  const key = JSON.stringify(readings)

  useEffect(() => {
    updateTrayReadings(readings)
  }, [key, unit])
}
