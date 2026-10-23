import path from 'path'
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { Credentials } from '../shared/linkup'
import {
  AlarmConfig,
  createAlarmStore,
  createPatientStore,
  resolveAlarmConfig,
} from '../shared/stores'
import { AlarmService } from './alarmService'
import { CredentialStore } from './credentialStore'
import { readJson, writeJson } from './persistence'
import { PollingService } from './pollingService'

export const patientStore = createPatientStore()
let service: PollingService | undefined
let alarmService: AlarmService | undefined
let unsubscribe: Array<() => void> = []

const broadcast = (channel: string, payload: unknown) =>
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload))

const snapshot = () => ({
  status: service?.getStatus() ?? 'signed-out',
  patients: Object.values(patientStore.getState().patients),
})

export const registerPollingHandler = () => {
  const dir = app.getPath('userData')
  const alarmFile = path.join(dir, 'alarms.json')
  const alarmStore = createAlarmStore({ overrides: readJson(alarmFile, {}) })

  service = new PollingService({
    credentials: new CredentialStore(path.join(dir, 'credentials.bin'), safeStorage),
    patients: patientStore,
    onStatus: () => broadcast('linkup:state', snapshot()),
  })

  alarmService = new AlarmService({
    patients: patientStore,
    alarms: alarmStore,
    onActive: (active) => broadcast('alarms:active', active),
    onNotify: (n) => broadcast('alarms:notify', n),
  })

  unsubscribe = [
    patientStore.subscribe(() => broadcast('linkup:state', snapshot())),
    alarmStore.subscribe((s) => {
      writeJson(alarmFile, s.overrides)
      broadcast('alarms:changed', s.overrides)
    }),
  ]

  ipcMain.handle('linkup:sign-in', (_e, credentials: Credentials) => service!.signIn(credentials))
  ipcMain.handle('linkup:get-state', () => snapshot())
  ipcMain.handle('alarms:get', (_e, patientId: string) => {
    const p = patientStore.getState().patients[patientId]
    return resolveAlarmConfig(alarmStore.getState(), patientId, p ?? {})
  })
  ipcMain.handle('alarms:set', (_e, patientId: string, patch: Partial<AlarmConfig>) =>
    alarmStore.getState().setConfig(patientId, patch),
  )
  ipcMain.handle('alarms:reset', (_e, patientId: string) =>
    alarmStore.getState().resetConfig(patientId),
  )
  ipcMain.handle('alarms:get-active', () => alarmService!.getActive())
  ipcMain.handle('alarms:acknowledge', (_e, patientId: string) =>
    alarmService!.acknowledge(patientId),
  )
  ipcMain.handle('alarms:snooze', (_e, patientId: string, minutes: number) =>
    alarmService!.snooze(patientId, minutes),
  )
  ipcMain.handle('alarms:clear-snooze', (_e, patientId: string) =>
    alarmService!.clearSnooze(patientId),
  )
  ipcMain.on('logout', () => service!.signOut())

  alarmService.start()
  service.startIfConfigured()
}

export const destroyPollingHandler = () => {
  alarmService?.stop()
  service?.stop()
  unsubscribe.forEach((u) => u())
  unsubscribe = []
  ;[
    'linkup:sign-in',
    'linkup:get-state',
    'alarms:get',
    'alarms:set',
    'alarms:reset',
    'alarms:get-active',
    'alarms:acknowledge',
    'alarms:snooze',
    'alarms:clear-snooze',
  ].forEach((c) => ipcMain.removeHandler(c))
}
