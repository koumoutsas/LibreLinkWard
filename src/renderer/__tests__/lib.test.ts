import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createElement, type ReactNode } from 'react'
import * as utils from '../lib/utils'
import { alarmLabel, describeAlarm } from '../lib/alarmText'
import { AudioManager } from '../lib/AudioManager'
import { getAuthToken, getCGMData, getConnection } from '../lib/linkup'
import { LinkUpClient, LinkUpError } from '../../shared/linkup'
import { useAuthStore } from '../stores/auth'
import { useAlertStore } from '../stores/alertStore'
import { useClearSession } from '../hooks/session'
import { useGlucoseAlerts } from '../hooks/useGlucoseAlerts'
import { useActiveAlarms } from '../hooks/useActiveAlarms'
import { useAlarmConfig } from '../hooks/useAlarmConfig'
import { usePatients } from '../hooks/usePatients'
import { useTrayReadings } from '../hooks/useTrayReadings'
import { stubElectron } from './helpers/electron'

jest.mock('../../shared/linkup', () => {
  const actual = jest.requireActual('../../shared/linkup')
  return { ...actual, LinkUpClient: jest.fn() }
})
const Client = LinkUpClient as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  useAuthStore.setState({ resultUnit: 'mg/dL', token: 't' })
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('utils', () => {
  it('forwards simple actions to the main process', async () => {
    const { ipcRenderer } = stubElectron(async () => 'ret')
    await utils.openFile('t', 'f', 'g', 'n')
    await utils.openNewWindow('/p', 1, 2)
    utils.sendRefreshAllWindows()
    utils.sendRefreshPrimaryWindow()
    utils.triggerWarningAlert({ a: 1 })
    expect(await utils.getAlertSoundFile()).toBe('ret')
    expect(await utils.uploadCustomAlertSoundFile([1])).toBe('ret')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipc-open-file', 't', 'f', 'g', 'n')
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('open-new-window', '/p', 1, 2)
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('refresh-all')
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('refresh-primary')
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('trigger-warning-alerts', { a: 1 })
  })

  it('remembers a redirect and joins class names', async () => {
    await utils.setRedirectTo('/x')
    expect(await utils.getRedirectTo()).toBe('/x')
    await utils.clearRedirectTo()
    expect(await utils.getRedirectTo()).toBeNull()
    expect(utils.cn('a', false && 'b', 'p-1', 'p-2')).toBe('a p-2')
  })

  it('converts values to the display unit', () => {
    expect(utils.getUserValue(100.4)).toBe(100)
    expect(utils.getUserUnit()).toBe('mg/dL')
    useAuthStore.setState({ resultUnit: 'mmol/L' })
    expect(utils.getUserValue(180)).toBe(10)
    useAuthStore.setState({ resultUnit: 'bogus' })
    expect(() => utils.getUserValue(1)).toThrow('Unsupported result unit')
  })

  it('hashes with sha256', () => {
    expect(utils.hash256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('tracks tray visibility and tells main to create or destroy it', async () => {
    const { ipcRenderer } = stubElectron()
    expect(utils.getTrayVisibility()).toBe(true)
    await utils.setTrayVisibility(false)
    expect(utils.getTrayVisibility()).toBe(false)
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('destroy-tray')
    await utils.setTrayVisibility(true)
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('create-tray')
  })

  it('logs out by hiding the tray and telling main', () => {
    const { ipcRenderer } = stubElectron()
    utils.sendLogout()
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('logout')
    expect(localStorage.getItem('trayVisible')).toBe('0')
  })

  it('sends tray readings only while the tray is visible', () => {
    const { ipcRenderer } = stubElectron()
    utils.updateTrayReadings([{ name: 'A', mgdl: 100 }])
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('update-tray-readings', [{ name: 'A', mgdl: 100 }], 'mg/dL')
    ipcRenderer.sendMessage.mockClear()
    localStorage.setItem('trayVisible', '0')
    utils.updateTrayReadings([])
    expect(ipcRenderer.sendMessage).not.toHaveBeenCalled()
    ;(window as any).electron = undefined
    expect(() => utils.updateTrayReadings([])).not.toThrow()
  })

  describe('getGlucoseValueForTray', () => {
    it('reads the latest value, or 0 when absent or failing', async () => {
      Client.mockImplementation(() => ({
        getConnections: async () => [{ patientId: 'p' }],
        getGraph: async () => ({ connection: { glucoseMeasurement: { ValueInMgPerDl: 123.4 } } }),
      }))
      expect(await utils.getGlucoseValueForTray('t', 'eu', 'a')).toBe(123)
      Client.mockImplementation(() => ({
        getConnections: async () => [{ patientId: 'p' }],
        getGraph: async () => ({ connection: {} }),
      }))
      expect(await utils.getGlucoseValueForTray('t', 'eu', 'a')).toBe(0)
      Client.mockImplementation(() => ({ getConnections: async () => { throw new Error('x') } }))
      expect(await utils.getGlucoseValueForTray('t', 'eu', 'a')).toBe(0)
    })
  })
})

describe('linkup adapters', () => {
  it('logs in and maps auth failures to their status', async () => {
    Client.mockImplementation(() => ({ login: async () => ({ token: 't', accountId: 'a', country: 'eu' }) }))
    expect(await getAuthToken({ country: 'x', username: 'u', password: 'p' })).toEqual({ token: 't', accountId: 'a', accountCountry: 'eu' })
    Client.mockImplementation(() => ({ login: async () => { throw new LinkUpError('bad', 'auth', 2) } }))
    expect(await getAuthToken({ country: 'x', username: 'u', password: 'p' })).toEqual({ error: 2 })
    const other = new Error('net')
    Client.mockImplementation(() => ({ login: async () => { throw other } }))
    await expect(getAuthToken({ country: 'x', username: 'u', password: 'p' })).rejects.toBe(other)
  })

  it('fetches the first connection graph, reports no connections, and swallows errors', async () => {
    const session = { token: 't', country: 'eu', accountId: 'a' } as any
    Client.mockImplementation(() => ({ getConnections: async () => [], }))
    expect(await getCGMData(session)).toMatchObject({ error: 'NO_CONNECTIONS' })
    expect(await getConnection(session)).toBeNull()
    Client.mockImplementation(() => ({ getConnections: async () => [{ patientId: 'p' }], getGraph: async () => ({ connection: { id: 1 } }) }))
    expect(await getCGMData(session)).toEqual({ id: 1 })
    expect(await getConnection(session)).toEqual({ patientId: 'p' })
    Client.mockImplementation(() => ({ getConnections: async () => { throw new Error('x') } }))
    expect(await getCGMData(session)).toBeNull()
    expect(await getConnection(session)).toBeNull()
  })
})

describe('alarm text', () => {
  it('labels alarms and formats readings', () => {
    expect(alarmLabel('urgent-low')).toBe('Urgent low')
    expect(describeAlarm('low', 65, 'mg/dL')).toBe('Low: 65 mg/dL')
    expect(describeAlarm('signal-loss', 65, 'mg/dL')).toBe('No data')
    expect(describeAlarm('high', undefined, 'mg/dL')).toBe('High')
  })
})

describe('AudioManager', () => {
  const audio: any = {}
  beforeEach(() => {
    ;(global as any).Audio = jest.fn(() => audio)
    audio.play = jest.fn(async () => {})
    ;(AudioManager as any).instance = undefined
  })

  it('is a singleton that skips playback while already playing', async () => {
    const m = AudioManager.getInstance()
    expect(AudioManager.getInstance()).toBe(m)
    await m.playAudio('a.mp3')
    audio.onplay()
    await m.playAudio('a.mp3')
    expect(audio.play).toHaveBeenCalledTimes(1)
    audio.onended()
    await m.playAudio('a.mp3')
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('recovers from a failing play', async () => {
    audio.play = jest.fn(async () => { throw new Error('blocked') })
    const m = AudioManager.getInstance()
    await m.playAudio('a.mp3')
    audio.play = jest.fn(async () => {})
    await m.playAudio('a.mp3')
    expect(audio.play).toHaveBeenCalled()
  })
})

describe('stores', () => {
  it('auth store logs in and out and keeps settings', () => {
    const s = useAuthStore.getState()
    s.login('tok', 'eu', 'en', 'acc')
    s.setCountry('us')
    s.setLanguage('fr')
    s.setResultUnit('mmol/L')
    expect(useAuthStore.getState()).toMatchObject({ token: 'tok', accountId: 'acc', country: 'us', language: 'fr', resultUnit: 'mmol/L' })
    s.logout()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('alert store setters work and rehydration keeps alarms off', async () => {
    const s = useAlertStore.getState()
    s.setBringToFrontEnabled(true)
    s.setFlashWindowEnabled(true)
    s.setAudioAlertEnabled(true)
    s.setUserCustomSoundEnabled(true)
    s.setOverrideThreshold(true)
    s.setCustomTargetLow(60)
    s.setCustomTargetHigh(200)
    expect(useAlertStore.getState()).toMatchObject({ useCustomSound: true, overrideThreshold: true, customTargetLow: 60, customTargetHigh: 200 })
    await useAlertStore.persist.rehydrate()
    expect(useAlertStore.getState()).toMatchObject({ bringToFrontEnabled: false, flashWindowEnabled: false, audioAlertEnabled: false, useCustomSound: true })
  })
})

describe('hooks', () => {
  it('useClearSession logs out, goes home and tells main', () => {
    const { ipcRenderer } = stubElectron()
    const wrapper = ({ children }: { children: ReactNode }) => createElement(MemoryRouter, null, children)
    const { result } = renderHook(() => useClearSession(), { wrapper })
    act(() => result.current.clearSession())
    expect(useAuthStore.getState().token).toBeNull()
    expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('logout')
  })

  describe('useGlucoseAlerts', () => {
    const flags = { bringToFrontEnabled: true, flashWindowEnabled: true, audioAlertEnabled: true, useCustomSound: false, overrideThreshold: false, customTargetLow: null, customTargetHigh: null }
    let play: jest.Mock
    beforeEach(() => {
      play = jest.fn(async () => {})
      jest.spyOn(AudioManager, 'getInstance').mockReturnValue({ playAudio: play } as any)
      useAlertStore.setState(flags)
    })

    it('stays quiet in range', async () => {
      const { ipcRenderer } = stubElectron()
      const { result } = renderHook(() => useGlucoseAlerts())
      await result.current.dispatchAlert(100, 70, 180)
      expect(ipcRenderer.sendMessage).not.toHaveBeenCalled()
    })

    it.each([[50], [250]])('alerts and plays the default sound for %i', async (v) => {
      const { ipcRenderer } = stubElectron(async () => ({ default: 'd.mp3', custom: 'c.mp3' }))
      const { result } = renderHook(() => useGlucoseAlerts())
      await result.current.dispatchAlert(v, 70, 180)
      expect(ipcRenderer.sendMessage).toHaveBeenCalledWith('trigger-warning-alerts', { bringToFrontEnabled: true, flashWindowEnabled: true })
      expect(play).toHaveBeenCalledWith('d.mp3')
    })

    it('prefers a custom sound and custom thresholds when enabled', async () => {
      useAlertStore.setState({ useCustomSound: true, overrideThreshold: true, customTargetLow: 90, customTargetHigh: 120 })
      stubElectron(async () => ({ default: 'd.mp3', custom: 'c.mp3' }))
      const { result } = renderHook(() => useGlucoseAlerts())
      await result.current.dispatchAlert(130, 70, 180)
      expect(play).toHaveBeenCalledWith('c.mp3')
    })

    it('skips audio when disabled or when no file is available, and survives errors', async () => {
      stubElectron(async () => ({}))
      const { result } = renderHook(() => useGlucoseAlerts())
      await result.current.dispatchAlert(50, 70, 180)
      expect(play).not.toHaveBeenCalled()
      useAlertStore.setState({ audioAlertEnabled: false })
      const again = renderHook(() => useGlucoseAlerts())
      await again.result.current.dispatchAlert(50, 70, 180)
      useAlertStore.setState({ audioAlertEnabled: true })
      stubElectron(async () => { throw new Error('x') })
      const failing = renderHook(() => useGlucoseAlerts())
      await expect(failing.result.current.dispatchAlert(50, 70, 180)).resolves.toBeUndefined()
    })
  })

  describe('useActiveAlarms', () => {
    it('loads, updates, notifies and acts', async () => {
      const ipc = stubElectron(async (ch) => (ch === 'alarms:get-active' ? [{ id: '1' }] : undefined))
      const onNotify = jest.fn()
      const { result, unmount } = renderHook(() => useActiveAlarms(onNotify))
      await waitFor(() => expect(result.current.alarms).toEqual([{ id: '1' }]))
      act(() => ipc.emit('alarms:active', [{ id: '2' }]))
      expect(result.current.alarms).toEqual([{ id: '2' }])
      act(() => ipc.emit('alarms:active', 'garbage'))
      expect(result.current.alarms).toEqual([{ id: '2' }])
      act(() => ipc.emit('alarms:notify', { sound: true }))
      expect(onNotify).toHaveBeenCalledWith({ sound: true })
      await result.current.acknowledge('x')
      await result.current.snooze('x', 5)
      expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('alarms:acknowledge', 'x')
      expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('alarms:snooze', 'x', 5)
      unmount()
      act(() => ipc.emit('alarms:active', [{ id: '3' }]))
    })

    it('works without a notify callback and ignores non-array initial state', async () => {
      const ipc = stubElectron(async () => 'nope')
      const { result } = renderHook(() => useActiveAlarms())
      act(() => ipc.emit('alarms:notify', {}))
      await waitFor(() => expect(ipc.ipcRenderer.invoke).toHaveBeenCalled())
      expect(result.current.alarms).toEqual([])
    })
  })

  describe('useAlarmConfig', () => {
    it('does nothing without a patient', async () => {
      const ipc = stubElectron()
      const { result } = renderHook(() => useAlarmConfig(undefined))
      await act(async () => result.current.update({ low: 1 }))
      expect(ipc.ipcRenderer.invoke).not.toHaveBeenCalled()
      expect(result.current.config).toBeUndefined()
    })
  })

  describe('usePatients', () => {
    it('reads the snapshot, follows updates and stops after unmount', async () => {
      const ipc = stubElectron(async () => ({ status: 'running', patients: [{ patientId: 'a' }] }))
      const { result, unmount } = renderHook(() => usePatients())
      await waitFor(() => expect(result.current.loaded).toBe(true))
      expect(result.current.patients).toHaveLength(1)
      act(() => ipc.emit('linkup:state', { status: 'running', patients: [] }))
      expect(result.current.patients).toHaveLength(0)
      unmount()
      act(() => ipc.emit('linkup:state', { status: 'x', patients: [{}] }))
    })

    it('keeps the signed-out default when main has nothing', async () => {
      stubElectron(async () => null)
      const { result } = renderHook(() => usePatients())
      await waitFor(() => expect(result.current.loaded).toBe(true))
      expect(result.current.status).toBe('signed-out')
    })
  })

  describe('useTrayReadings', () => {
    it('pushes one reading per patient with stale flags', async () => {
      const ts = new Date().toISOString()
      const latest = { Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: 110 }
      const ipc = stubElectron(async (ch) =>
        ch === 'linkup:get-state'
          ? { status: 'running', patients: [{ patientId: 'a', name: 'A', latest, targetLow: 70, targetHigh: 180 }, { patientId: 'b', name: 'B' }] }
          : ch === 'alarms:get-active'
            ? [{ kind: 'signal-loss', patientId: 'a' }]
            : undefined,
      )
      renderHook(() => useTrayReadings())
      await waitFor(() =>
        expect(ipc.ipcRenderer.sendMessage).toHaveBeenCalledWith(
          'update-tray-readings',
          [{ name: 'A', mgdl: 110, targetLow: 70, targetHigh: 180, trend: 3, stale: true }],
          'mg/dL',
        ),
      )
    })
  })
})
