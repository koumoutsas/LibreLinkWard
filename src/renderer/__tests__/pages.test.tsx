import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import LoginPage from '../pages/login'
import LandingPage from '../pages/landing'
import PatientPage from '../pages/patient'
import SettingsAccountsPage from '../pages/settings/accounts'
import SettingsGeneralPage from '../pages/settings/general'
import { reloadApp } from '../lib/reload'
import { useAuthStore } from '../stores/auth'
import { useAlertStore } from '../stores/alertStore'
import '../i18n/config'
import { stubBrowser, stubElectron } from './helpers/electron'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() }, Toaster: () => null }))
jest.mock('../lib/reload', () => ({ reloadApp: jest.fn() }))

beforeAll(() => {
  stubBrowser()
  // Radix Select needs these in jsdom.
  window.PointerEvent ??= class extends MouseEvent {
    pointerType: string
    constructor(type: string, init: any = {}) {
      super(type, init)
      this.pointerType = init.pointerType ?? 'mouse'
    }
  } as any
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

const Where = () => <p data-testid="where">{useLocation().pathname}</p>
const at = (path: string, routes: Array<[string, JSX.Element]>) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        {routes.map(([p, el]) => (
          <Route key={p} path={p} element={el} />
        ))}
      </Routes>
    </MemoryRouter>,
  )

async function pick(trigger: HTMLElement, option: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  useAuthStore.setState({ resultUnit: 'mg/dL', language: 'en', country: 'global' })
})

describe('LoginPage (language picker)', () => {
  const english = () => screen.getByTestId('language-en')

  it('preselects English but waits for the user to continue', () => {
    useAuthStore.setState({ language: null, country: null })
    at('/login', [['/login', <LoginPage />], ['/dashboard', <p>dash</p>]])
    expect(english()).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()
    expect(useAuthStore.getState().language).toBeNull()
    expect(screen.queryByText('dash')).not.toBeInTheDocument()
  })

  it('stores the chosen language and opens the dashboard', async () => {
    useAuthStore.setState({ language: null, country: null })
    at('/login', [['/login', <LoginPage />], ['/dashboard', <p>dash</p>]])
    fireEvent.click(screen.getByTestId('language-de'))
    expect(screen.getByTestId('language-de')).toHaveAttribute('aria-checked', 'true')
    expect(english()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: /continue|weiter/i }))
    await screen.findByText('dash')
    expect(useAuthStore.getState()).toMatchObject({ language: 'de', country: 'global' })
  })

  it('keeps an existing country', async () => {
    useAuthStore.setState({ language: null, country: 'eu' })
    at('/login', [['/login', <LoginPage />], ['/dashboard', <p>dash</p>]])
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByText('dash')
    expect(useAuthStore.getState()).toMatchObject({ language: 'en', country: 'eu' })
  })
})

describe('LandingPage', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('goes to the login screen after the splash', async () => {
    at('/', [['/', <LandingPage />], ['/login', <p>login</p>]])
    await act(async () => void jest.advanceTimersByTime(3100))
    expect(screen.getByText('login')).toBeInTheDocument()
  })

  it('returns to a remembered page once, then clears it', async () => {
    localStorage.setItem('redirectTo', '/settings/general')
    at('/', [['/', <LandingPage />], ['/settings/general', <p>general</p>]])
    await act(async () => void jest.advanceTimersByTime(3100))
    expect(screen.getByText('general')).toBeInTheDocument()
    expect(localStorage.getItem('redirectTo')).toBeNull()
  })

  it('cancels the redirect when unmounted early', () => {
    const view = at('/', [['/', <LandingPage />], ['/login', <p>login</p>]])
    view.unmount()
    act(() => void jest.advanceTimersByTime(3100))
    expect(screen.queryByText('login')).not.toBeInTheDocument()
  })
})

describe('PatientPage', () => {
  const ts = new Date().toISOString()
  const p = {
    patientId: 'p1', name: 'Alice', targetLow: 70, targetHigh: 180, accountId: 'a',
    history: [{ Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: 100, TrendArrow: 3 }],
    latest: { Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: 100, TrendArrow: 3 },
    status: 'ok', lastUpdated: Date.now(),
  }
  const mount = (patients: any[], alarms: any = { low: 65, high: 170 }) => {
    const ipc = stubElectron(async (ch) => (ch === 'linkup:get-state' ? { status: 'running', patients } : ch === 'alarms:get' ? alarms : []))
    at('/patients/p1', [['/patients/:patientId', <PatientPage />], ['/dashboard', <p>dash</p>]])
    return ipc
  }

  it('shows the patient, switches range and opens the alarm settings window', async () => {
    const ipc = mount([p])
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    fireEvent.click(screen.getByText('12 h'))
    fireEvent.click(screen.getByText('Alarms'))
    expect(localStorage.getItem('redirectTo')).toBe('/settings/patients/p1')
    expect(ipc.ipcRenderer.sendMessage).toHaveBeenCalledWith('open-new-window', '/settings/patients/p1', 1024, 768)
  })

  it('shows -- instead of the value when the reading is older than the signal-loss timeout', async () => {
    const old = new Date(Date.now() - 90 * 60000).toISOString()
    const latest = { Timestamp: old, FactoryTimestamp: old, ValueInMgPerDl: 100, TrendArrow: 3 }
    mount([{ ...p, latest, history: [latest] }], { low: 65, high: 170, signalLossMinutes: 20 })
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('--')).toBeInTheDocument()
    expect(screen.queryByText('100')).not.toBeInTheDocument()
  })

  it('handles a patient without readings or targets', async () => {
    mount([{ ...p, latest: undefined, history: [], targetLow: undefined, targetHigh: undefined }], undefined)
    expect(await screen.findByText('Alice')).toBeInTheDocument()
  })

  it('says so when the patient is unknown, and goes back', async () => {
    mount([])
    expect(await screen.findByText('Patient not found.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Patients'))
    expect(screen.getByText('dash')).toBeInTheDocument()
  })
})

describe('SettingsAccountsPage', () => {
  const accounts = [
    { id: 'a', username: 'parent@example.com', kind: 'linkup', status: 'running' },
    { id: 'n', username: 'Home site', kind: 'nightscout', status: 'running', url: 'https://ns' },
  ]
  const patients = [
    { patientId: 'p1', name: 'Alice', accountId: 'a', history: [], status: 'ok', lastUpdated: 0 },
    { patientId: 'p2', name: 'Bob', accountId: 'n', history: [], status: 'ok', lastUpdated: 0 },
  ]
  const mount = (path: string, state: any) => {
    const ipc = stubElectron(async (ch) => (ch === 'linkup:get-state' ? state : ch === 'alarms:get' ? undefined : { enabled: false, url: '', deviceName: '', hasSecret: false, status: {} }))
    at(path, [['/settings/accounts', <SettingsAccountsPage />], ['/settings/patients/:patientId', <SettingsAccountsPage />], ['/settings/general', <p>general</p>]])
    return ipc
  }

  it('shows every login with its patients, Nightscout upload only for LibreLinkUp', async () => {
    mount('/settings/accounts', { status: 'running', accounts, patients })
    expect(await screen.findByText('parent@example.com')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByTestId('settings-account-n')).toBeInTheDocument()
    expect(await screen.findAllByTestId('nightscout-settings')).toHaveLength(1)
    expect(screen.getByTestId('nightscout-site-settings')).toBeInTheDocument()
  })

  it('removes a login', async () => {
    const ipc = mount('/settings/accounts', { status: 'running', accounts, patients })
    fireEvent.click((await screen.findAllByText('Logout'))[0])
    expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('linkup:remove-account', 'a')
  })

  it('focuses the login of the patient it was opened for', async () => {
    mount('/settings/patients/p2', { status: 'running', accounts, patients })
    await screen.findByText('Home site')
    expect(screen.queryByText('parent@example.com')).not.toBeInTheDocument()
  })

  it('has an empty state and navigates through the sidebar', async () => {
    mount('/settings/accounts', { status: 'running', patients: [] })
    expect(await screen.findByText('No accounts yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('General'))
    expect(screen.getByText('general')).toBeInTheDocument()
  })
})

describe('SettingsGeneralPage', () => {
  let ipc: ReturnType<typeof stubElectron>
  beforeEach(() => {
    ipc = stubElectron()
    useAlertStore.setState({ bringToFrontEnabled: false, flashWindowEnabled: false, audioAlertEnabled: false, useCustomSound: false })
    useAuthStore.setState({ showForecast: false, showForecastCone: false })
  })

  const open = () => at('/settings/general', [['/settings/general', <SettingsGeneralPage />]])

  it('changes unit, country, language and theme', async () => {
    open()
    const [theme, country, language, unit] = screen.getAllByRole('combobox')
    await pick(unit, 'mmol/L')
    expect(useAuthStore.getState().resultUnit).toBe('mmol/L')
    expect(ipc.ipcRenderer.sendMessage).toHaveBeenCalledWith('refresh-primary')
    await pick(country, 'Germany')
    expect(useAuthStore.getState().country).toBe('de')
    await pick(theme, 'Dark')
    expect(localStorage.getItem('vite-ui-theme')).toBe('dark')
    expect(localStorage.getItem('redirectTo')).toBe('/settings/general')
    expect(reloadApp).toHaveBeenCalled()
    await pick(language, 'German')
    expect(useAuthStore.getState().language).toBe('de')
  })

  it('toggles the tray and applies changes', async () => {
    open()
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[0])
    await waitFor(() => expect(ipc.ipcRenderer.sendMessage).toHaveBeenCalledWith('destroy-tray'))
    expect(localStorage.getItem('trayVisible')).toBe('0')
    fireEvent.click(screen.getByText('Apply Changes'))
    expect(ipc.ipcRenderer.sendMessage).toHaveBeenCalledWith('refresh-primary')
  })

  it('toggles the AR2 forecast', () => {
    open()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(useAuthStore.getState().showForecast).toBe(true)
    expect(ipc.ipcRenderer.sendMessage).not.toHaveBeenCalledWith('refresh-primary')
    fireEvent.click(screen.getByText('Apply Changes'))
    expect(ipc.ipcRenderer.sendMessage).toHaveBeenCalledWith('refresh-primary')
  })

  it('offers the forecast cone only while the forecast is on', () => {
    open()
    expect(screen.queryByText('Show forecast cone')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByText('Show forecast cone')).toBeInTheDocument()
    // Enabling the forecast switches the cone on; the user can then turn it off.
    expect(useAuthStore.getState().showForecastCone).toBe(true)
    fireEvent.click(screen.getAllByRole('checkbox')[2])
    expect(useAuthStore.getState().showForecastCone).toBe(false)
  })

  it('reveals the sound options as alerts are switched on', async () => {
    open()
    const boxes = () => screen.getAllByRole('checkbox')
    fireEvent.click(boxes()[2])
    fireEvent.click(boxes()[3])
    fireEvent.click(boxes()[4])
    expect(useAlertStore.getState()).toMatchObject({ bringToFrontEnabled: true, flashWindowEnabled: true, audioAlertEnabled: true })
    fireEvent.click(boxes()[5])
    expect(useAlertStore.getState().useCustomSound).toBe(true)
    expect(screen.getByText('Upload Sound')).toBeInTheDocument()
  })

  describe('custom sound upload', () => {
    let input: HTMLInputElement
    beforeEach(() => {
      useAlertStore.setState({ audioAlertEnabled: true, useCustomSound: true })
      const create = document.createElement.bind(document)
      jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const el = create(tag)
        if (tag === 'input') {
          input = el as HTMLInputElement
          jest.spyOn(el, 'click').mockImplementation(() => {})
        }
        return el
      }) as any)
    })
    afterEach(() => jest.restoreAllMocks())

    it('reads the chosen file and sends its bytes to main', async () => {
      open()
      fireEvent.click(screen.getByText('Upload Sound'))
      const file = new File([new Uint8Array([1, 2, 3])], 's.mp3')
      Object.defineProperty(input, 'files', { value: [file] })
      await act(async () => void (await input.onchange!({ target: input } as any)))
      await waitFor(() => expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('upload-custom-alert-sound', [1, 2, 3]))
    })

    it('ignores a cancelled selection', async () => {
      open()
      fireEvent.click(screen.getByText('Upload Sound'))
      await input.onchange!({ target: { files: [] } } as any)
      await input.onchange!({ target: { files: null } } as any)
      expect(ipc.ipcRenderer.invoke).not.toHaveBeenCalled()
    })
  })
})
