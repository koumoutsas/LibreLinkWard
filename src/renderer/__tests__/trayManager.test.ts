const pages: string[] = []

jest.mock('electron', () => {
  const image = (): any => ({ setTemplateImage: jest.fn(), toPNG: jest.fn(() => Buffer.from('')), isEmpty: () => false, resize: jest.fn(() => image()) })
  class BrowserWindow {
    webContents = {
      executeJavaScript: jest.fn(async () => 100),
      capturePage: jest.fn(async () => image()),
      send: jest.fn(),
      on: jest.fn(),
    }
    on = jest.fn()
    loadURL = jest.fn(async (url: string) => { pages.push(decodeURIComponent(url)) })
    setContentSize = jest.fn()
    setSize = jest.fn()
    isDestroyed = () => false
    destroy = jest.fn()
  }
  class Tray {
    on = jest.fn()
    setImage = jest.fn()
    setTitle = jest.fn()
    setToolTip = jest.fn()
    setContextMenu = jest.fn()
    getBounds = jest.fn(() => ({ x: 0, y: 0, width: 0, height: 0 }))
    destroy = jest.fn()
  }
  return {
    Tray,
    BrowserWindow,
    Menu: { buildFromTemplate: jest.fn(() => ({})) },
    nativeImage: { createFromPath: jest.fn(() => image()), createFromBuffer: jest.fn(() => image()), createEmpty: jest.fn(() => image()) },
    app: { getAppPath: () => '/app', quit: jest.fn() },
  }
})

import { BrowserWindow } from 'electron'
import { createTray, updateTrayReadings, destroyTray } from '../lib/trayManager'

const GRAY = 'rgb(107, 114, 128)'
const GREEN = 'rgb(34, 197, 94)'
const RED = 'rgb(239, 68, 68)'

/** The pills drawn in the last text image: [text, background]. */
const lastPills = () => {
  const html = [...pages].reverse().find((p) => p.includes('id="t"')) ?? ''
  return [...html.matchAll(/<span style="background:([^;]+);[^>]*>([^<]*)<\/span>/g)].map((m) => [m[2], m[1]])
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 150))

describe('tray pills (macOS)', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    ;(process as any).resourcesPath = '/resources'
    createTray(new BrowserWindow() as any)
  })
  afterAll(() => {
    destroyTray()
    Object.defineProperty(process, 'platform', platform)
  })
  beforeEach(() => { pages.length = 0 })

  it('shows one coloured pill for a single patient', async () => {
    updateTrayReadings([{ name: 'A', mgdl: 100 }], 'mg/dL')
    await flush()
    expect(lastPills()).toEqual([['100→', GREEN]])
  })

  it('shows lowest and highest when several patients have values', async () => {
    updateTrayReadings([{ name: 'A', mgdl: 60 }, { name: 'B', mgdl: 120 }], 'mg/dL')
    await flush()
    expect(lastPills()).toEqual([['60→', RED], ['120→', GREEN]])
  })

  it('adds a gray -- pill when some patients have lost signal', async () => {
    updateTrayReadings([{ name: 'A', mgdl: 100 }, { name: 'B', mgdl: 250, stale: true }], 'mg/dL')
    await flush()
    expect(lastPills()).toEqual([['100→', GREEN], ['--', GRAY]])
  })

  it('keeps stale patients out of min and max', async () => {
    updateTrayReadings(
      [{ name: 'A', mgdl: 100 }, { name: 'B', mgdl: 140 }, { name: 'C', mgdl: 40, stale: true }],
      'mg/dL',
    )
    await flush()
    expect(lastPills()).toEqual([['100→', GREEN], ['140→', GREEN], ['--', GRAY]])
  })

  it('shows only -- when every patient has lost signal', async () => {
    updateTrayReadings([{ name: 'A', mgdl: 100, stale: true }, { name: 'B', mgdl: 90, stale: true }], 'mg/dL')
    await flush()
    expect(lastPills()).toEqual([['--', GRAY]])
  })
})
