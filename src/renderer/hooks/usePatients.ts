import { useEffect, useState } from 'react'
import type { PatientState } from '../../shared/stores'

export type LinkUpStatus = string

export type AccountInfo = { id: string; username: string; status: 'running' | 'auth-error' }

export type LinkUpSnapshot = { status: LinkUpStatus; accounts?: AccountInfo[]; patients: PatientState[] }

/** Live view of the main-process patient store via `linkup:*` IPC. */
export function usePatients(): LinkUpSnapshot & { loaded: boolean } {
  const [snapshot, setSnapshot] = useState<LinkUpSnapshot>({ status: 'signed-out', patients: [] })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    const { ipcRenderer } = window.electron
    const unsubscribe = ipcRenderer.on('linkup:state', (s) => active && setSnapshot(s as LinkUpSnapshot))
    Promise.resolve(ipcRenderer.invoke('linkup:get-state'))
      .then((s) => {
        if (active && s) setSnapshot(s)
      })
      .finally(() => active && setLoaded(true))
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  return { ...snapshot, loaded }
}
