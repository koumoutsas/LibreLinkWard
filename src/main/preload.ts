// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron"

export type Channels = string

/** Channels the renderer may use; anything else is refused. */
const ALLOWED = /^(alarms:[a-z-]+|linkup:[a-z-]+|nightscout:[a-z-]+|get-alert-sound-file|upload-custom-alert-sound|ipc-open-file|open-new-window|logout|logout-event|refresh-all|refresh-primary|trigger-warning-alerts|update-tray-readings|create-tray|destroy-tray)$/

const check = (channel: Channels) => {
  if (!ALLOWED.test(channel)) throw new Error(`IPC channel not allowed: ${channel}`)
}

const electronHandler = {
  ipcRenderer: {
    // IPC replies are untyped; call sites narrow them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoke(channel: Channels, ...args: unknown[]): Promise<any> {
      check(channel)
      return ipcRenderer.invoke(channel, ...args);
    },
    sendMessage(channel: Channels, ...args: unknown[]) {
      check(channel)
      ipcRenderer.send(channel, ...args)
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      check(channel)
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args)
      ipcRenderer.on(channel, subscription)

      return () => {
        ipcRenderer.removeListener(channel, subscription)
      }
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      check(channel)
      ipcRenderer.once(channel, (_event, ...args) => func(...args))
    },
  },
}

contextBridge.exposeInMainWorld('electron', electronHandler)

export type ElectronHandler = typeof electronHandler
