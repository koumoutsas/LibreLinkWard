import { useCallback, useEffect, useState } from 'react'
import type { AlarmConfig } from '../../shared/stores'

/** Resolved alarm config (overrides over sensor defaults) for one patient. */
export function useAlarmConfig(patientId: string | undefined) {
  const [config, setConfig] = useState<AlarmConfig>()

  const refresh = useCallback(async () => {
    if (!patientId) return
    setConfig(await window.electron.ipcRenderer.invoke('alarms:get', patientId))
  }, [patientId])

  useEffect(() => {
    refresh()
    return window.electron.ipcRenderer.on('alarms:changed', () => {
      refresh()
    })
  }, [refresh])

  const update = useCallback(
    async (patch: Partial<AlarmConfig>) => {
      if (!patientId) return
      await window.electron.ipcRenderer.invoke('alarms:set', patientId, patch)
      await refresh()
    },
    [patientId, refresh],
  )

  return { config, update }
}
