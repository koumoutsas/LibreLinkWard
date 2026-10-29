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
import { NightscoutClient } from './nightscout/client'
import { DEFAULT_DEVICE_NAME, NightscoutConfig, NightscoutConfigStore } from './nightscout/configStore'
import { NightscoutUploader } from './nightscout/uploader'

export const patientStore = createPatientStore()
let service: PollingService | undefined
let alarmService: AlarmService | undefined
let uploader: NightscoutUploader | undefined
let unsubscribe: Array<() => void> = []

const broadcast = (channel: string, payload: unknown) =>
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload))

const snapshot = () => ({
  status: service?.getStatus() ?? 'signed-out',
  accounts: service?.getAccounts() ?? [],
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

  const nsStore = new NightscoutConfigStore(path.join(dir, 'nightscout.bin'), safeStorage)
  let nsConfigs = nsStore.load()
  uploader = new NightscoutUploader({
    patients: patientStore,
    onStatus: () => broadcast('nightscout:changed', null),
  })
  uploader.setConfigs(nsConfigs)

  unsubscribe = [
    patientStore.subscribe(() => broadcast('linkup:state', snapshot())),
    alarmStore.subscribe((s) => {
      writeJson(alarmFile, s.overrides)
      broadcast('alarms:changed', s.overrides)
    }),
  ]

  ipcMain.handle('linkup:sign-in', (_e, credentials: Credentials) => service!.signIn(credentials))
  ipcMain.handle(
    'linkup:add-nightscout',
    (_e, input: { url: string; apiSecret?: string; name?: string }) => service!.addNightscout(input),
  )
  ipcMain.handle('linkup:remove-account', (_e, accountId: string) =>
    service!.removeAccount(accountId),
  )
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
  // The API secret only goes back to the renderer on an explicit reveal; otherwise just whether one is set.
  ipcMain.handle('nightscout:get', (_e, patientId: string) => {
    const c = nsConfigs[patientId]
    return {
      enabled: c?.enabled ?? false,
      url: c?.url ?? '',
      deviceName: c?.deviceName ?? DEFAULT_DEVICE_NAME,
      hasSecret: !!c?.apiSecret,
      status: uploader!.getStatus(patientId),
    }
  })
  ipcMain.handle('nightscout:reveal-secret', (_e, patientId: string) => nsConfigs[patientId]?.apiSecret ?? '')
  ipcMain.handle(
    'nightscout:set',
    (_e, patientId: string, patch: Partial<NightscoutConfig>) => {
      const prev = nsConfigs[patientId]
      const next: NightscoutConfig = {
        ...{ enabled: false, url: '', apiSecret: '', deviceName: DEFAULT_DEVICE_NAME },
        ...prev,
        ...patch,
      }
      // An empty secret in the patch means "unchanged".
      if (!patch.apiSecret) next.apiSecret = prev?.apiSecret ?? ''
      nsConfigs = { ...nsConfigs, [patientId]: next }
      nsStore.save(nsConfigs)
      uploader!.setConfigs(nsConfigs)
    },
  )
  ipcMain.handle(
    'nightscout:test',
    async (_e, patientId: string, draft: { url: string; apiSecret?: string }) => {
      const apiSecret = draft.apiSecret || nsConfigs[patientId]?.apiSecret || ''
      try {
        await new NightscoutClient({ url: draft.url, apiSecret }).testConnection()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )
  ipcMain.on('logout', () => service!.signOut())

  alarmService.start()
  uploader.start()
  service.startIfConfigured()
}

export const destroyPollingHandler = () => {
  alarmService?.stop()
  uploader?.stop()
  service?.stop()
  unsubscribe.forEach((u) => u())
  unsubscribe = []
  ;[
    'linkup:sign-in',
    'linkup:remove-account',
    'linkup:add-nightscout',
    'linkup:get-state',
    'alarms:get',
    'alarms:set',
    'alarms:reset',
    'alarms:get-active',
    'alarms:acknowledge',
    'alarms:snooze',
    'alarms:clear-snooze',
    'nightscout:get',
    'nightscout:reveal-secret',
    'nightscout:set',
    'nightscout:test',
  ].forEach((c) => ipcMain.removeHandler(c))
}
