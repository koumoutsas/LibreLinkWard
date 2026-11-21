import path from 'path'
import { app, BrowserWindow, ipcMain, Notification, safeStorage } from 'electron'
import { Credentials } from '../shared/linkup'
import {
  AlarmConfig,
  createAlarmStore,
  createPatientStore,
  resolveAlarmConfig,
} from '../shared/stores'
import { AlarmService } from './alarmService'
import { CredentialStore, toSafeStorage } from './credentialStore'
import { readJson, writeJson } from './persistence'
import { PollingService } from './pollingService'
import { NightscoutClient } from './nightscout/client'
import { DEFAULT_DEVICE_NAME, NightscoutConfig, NightscoutConfigStore } from './nightscout/configStore'
import { NightscoutUploader } from './nightscout/uploader'
import { parseBlob } from './recording/blob'
import { RecordingConfigs, RecordingConfigStore } from './recording/configStore'
import { FirehosePublisher } from './recording/publisher'
import { Recorder } from './recording/recorder'

export const patientStore = createPatientStore()
let service: PollingService | undefined
let alarmService: AlarmService | undefined
let uploader: NightscoutUploader | undefined
let recorder: Recorder | undefined
let unsubscribe: Array<() => void> = []

const broadcast = (channel: string, payload: unknown) =>
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload))

const snapshot = () => ({
  status: service?.getStatus() ?? 'signed-out',
  accounts: service?.getAccounts() ?? [],
  patients: Object.values(patientStore.getState().patients),
  recording: recorder?.summary() ?? {},
})

export const registerPollingHandler = async () => {
  const dir = app.getPath('userData')
  const alarmFile = path.join(dir, 'alarms.json')
  const alarmStore = createAlarmStore({ overrides: readJson(alarmFile, {}) })

  service = new PollingService({
    credentials: new CredentialStore(path.join(dir, 'credentials.bin'), toSafeStorage(safeStorage)),
    patients: patientStore,
    onStatus: () => broadcast('linkup:state', snapshot()),
  })

  alarmService = new AlarmService({
    patients: patientStore,
    alarms: alarmStore,
    onActive: (active) => broadcast('alarms:active', active),
    onNotify: (n) => {
      broadcast('alarms:notify', n)
      if (n.kind.startsWith('predicted') && Notification.isSupported()) {
        const what = n.kind === 'predicted-low' ? 'Low' : 'High'
        new Notification({ title: n.name, body: `${what} predicted within 30 minutes (now ${n.value ?? '--'} mg/dL)`, silent: true }).show()
      }
    },
  })

  const nsStore = new NightscoutConfigStore(path.join(dir, 'nightscout.bin'), toSafeStorage(safeStorage))
  let nsConfigs = await nsStore.load()
  uploader = new NightscoutUploader({
    patients: patientStore,
    onStatus: () => broadcast('nightscout:changed', null),
  })
  uploader.setConfigs(nsConfigs)

  const recStore = new RecordingConfigStore(path.join(dir, 'recording.bin'), toSafeStorage(safeStorage))
  let recConfigs: RecordingConfigs = await recStore.load()
  recorder = new Recorder({
    patients: patientStore,
    sidOf: (key) => service!.sidFor(key),
    stateFile: path.join(dir, 'recording-state.json'),
    appVersion: app.getVersion(),
    onStatus: () => {
      broadcast('recording:changed', null)
      broadcast('linkup:state', snapshot())
    },
  })
  recorder.setConfigs(recConfigs)
  const saveRecording = async (next: RecordingConfigs) => {
    await recStore.save(next)
    recConfigs = next
    recorder!.setConfigs(recConfigs)
    broadcast('recording:changed', null)
    broadcast('linkup:state', snapshot())
  }
  /** Forgets recording settings, queue and watermark of every view matching the predicate. */
  const dropRecording = (match: (key: string) => boolean) =>
    saveRecording(Object.fromEntries(Object.entries(recConfigs).filter(([k]) => !match(k))))

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
  ipcMain.handle(
    'linkup:update-nightscout',
    (_e, accountId: string, input: { url: string; apiSecret?: string; name?: string }) =>
      service!.updateNightscout(accountId, input),
  )
  ipcMain.handle('linkup:reveal-nightscout-secret', (_e, accountId: string) =>
    service!.getNightscoutSecret(accountId),
  )
  ipcMain.handle('linkup:remove-account', async (_e, accountId: string) => {
    await service!.removeAccount(accountId)
    await dropRecording((k) => k.startsWith(`${accountId}~`))
  })
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
    async (_e, patientId: string, patch: Partial<NightscoutConfig>) => {
      const prev = nsConfigs[patientId]
      const next: NightscoutConfig = {
        ...{ enabled: false, url: '', apiSecret: '', deviceName: DEFAULT_DEVICE_NAME },
        ...prev,
        ...patch,
      }
      // An empty secret in the patch means "unchanged".
      if (!patch.apiSecret) next.apiSecret = prev?.apiSecret ?? ''
      nsConfigs = { ...nsConfigs, [patientId]: next }
      await nsStore.save(nsConfigs)
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
  // The secret only ever goes in; the renderer gets the rest of the target and the status.
  ipcMain.handle('recording:get', (_e, key: string) => {
    const c = recConfigs[key]
    return {
      sid: service!.sidFor(key),
      enabled: c?.enabled ?? false,
      hasBlob: !!c,
      install: c?.target.install,
      region: c?.target.region,
      stream: c?.target.stream,
      status: recorder!.getStatus(key),
    }
  })
  ipcMain.handle('recording:set-blob', async (_e, key: string, blob: string) => {
    try {
      const sid = service!.sidFor(key)
      if (!sid) throw new Error('Unknown patient')
      const target = parseBlob(blob, sid)
      // A new config starts disabled; the operator turns it on explicitly.
      await saveRecording({ ...recConfigs, [key]: { target, enabled: false } })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('recording:set-enabled', async (_e, key: string, enabled: boolean) => {
    const c = recConfigs[key]
    if (!c) return
    // Turning on starts fresh: nothing from before this moment is sent.
    await saveRecording({
      ...recConfigs,
      [key]: { ...c, enabled, enabledAt: enabled ? Date.now() : undefined },
    })
  })
  ipcMain.handle('recording:test', async (_e, key: string) => {
    const c = recConfigs[key]
    if (!c) return { ok: false, error: 'No recording config' }
    try {
      await new FirehosePublisher(c.target).test()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('recording:clear', (_e, key: string) => dropRecording((k) => k === key))
  ipcMain.on('logout', () => {
    service!.signOut()
    dropRecording(() => true).catch((e) => console.error("Could not clear recording settings:", e))
  })

  alarmService.start()
  uploader.start()
  recorder.start()
  await service.startIfConfigured()
}

export const destroyPollingHandler = () => {
  alarmService?.stop()
  uploader?.stop()
  recorder?.stop()
  service?.stop()
  unsubscribe.forEach((u) => u())
  unsubscribe = []
  ;[
    'linkup:sign-in',
    'linkup:remove-account',
    'linkup:add-nightscout',
    'linkup:update-nightscout',
    'linkup:reveal-nightscout-secret',
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
    'recording:get',
    'recording:set-blob',
    'recording:set-enabled',
    'recording:test',
    'recording:clear',
  ].forEach((c) => ipcMain.removeHandler(c))
}
