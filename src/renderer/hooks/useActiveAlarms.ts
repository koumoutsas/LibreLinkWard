import { useEffect, useState } from 'react'
import type { ActiveAlarm, AlarmNotification } from '../../main/alarmService'

/** Live list of active alarms from the main-process alarm engine. */
export function useActiveAlarms(onNotify?: (n: AlarmNotification) => void) {
  const [alarms, setAlarms] = useState<ActiveAlarm[]>([])

  useEffect(() => {
    let active = true
    const { ipcRenderer } = window.electron
    const unsubs = [
      ipcRenderer.on('alarms:active', (a) => active && Array.isArray(a) && setAlarms(a as ActiveAlarm[])),
      ipcRenderer.on('alarms:notify', (n) => active && onNotify?.(n as AlarmNotification)),
    ]
    Promise.resolve(ipcRenderer.invoke('alarms:get-active')).then((a) => {
      if (active && Array.isArray(a)) setAlarms(a)
    })
    return () => {
      active = false
      unsubs.forEach((u) => u?.())
    }
    // onNotify is read through a ref-like closure per render; re-subscribing is cheap.
  }, [onNotify])

  const ipc = () => window.electron.ipcRenderer
  return {
    alarms,
    acknowledge: (id: string) => ipc().invoke('alarms:acknowledge', id),
    snooze: (id: string, minutes: number) => ipc().invoke('alarms:snooze', id, minutes),
  }
}
