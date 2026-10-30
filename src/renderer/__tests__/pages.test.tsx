import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import LoginPage from '../pages/login'
import LandingPage from '../pages/landing'
import PatientPage from '../pages/patient'
import SettingsAccountsPage from '../pages/settings/accounts'
import SettingsGeneralPage from '../pages/settings/general'
import { getAuthToken } from '../lib/linkup'
import { useAuthStore } from '../stores/auth'
import { useAlertStore } from '../stores/alertStore'
import '../i18n/config'
import { stubBrowser, stubElectron } from './helpers/electron'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() }, Toaster: () => null }))
jest.mock('../lib/linkup', () => ({ getAuthToken: jest.fn() }))

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
  useAuthStore.setState({ token: null, resultUnit: 'mg/dL', language: 'en', country: 'global' })
})

describe('LoginPage', () => {
  const fill = async (u = 'user', p = 'secret') => {
    await pick(screen.getAllByRole('combobox')[0], 'English')
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: u } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: p } })
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[type=submit]')!)
  }
  let ipc: ReturnType<typeof stubElectron>
  beforeEach(() => {
    ipc = stubElectron()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('validates required fields', async () => {
    at('/login', [['/login', <LoginPage />]])
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[type=submit]')!)
    await waitFor(() => expect(screen.getAllByText(/at least 2/i).length).toBeGreaterThan(0))
    expect(getAuthToken).not.toHaveBeenCalled()
  })

  it('signs in, hands the credentials to main and opens the dashboard', async () => {
    ;(getAuthToken as jest.Mock).mockResolvedValue({ token: 'tok', accountId: 'acc', accountCountry: 'eu' })
    at('/login', [['/login', <LoginPage />], ['/dashboard', <p>dash</p>]])
    await fill()
    await screen.findByText('dash')
    expect(useAuthStore.getState()).toMatchObject({ token: 'tok', accountId: 'acc', country: 'eu' })
    expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('linkup:sign-in', { country: 'eu', username: 'user', password: 'secret' })
  })

  it('falls back to the chosen country and empty ids when the answer omits them', async () => {
    ;(getAuthToken as jest.Mock).mockResolvedValue({})
    at('/login', [['/login', <LoginPage />], ['/dashboard', <p>dash</p>]])
    await fill()
    await screen.findByText('dash')
    expect(useAuthStore.getState()).toMatchObject({ token: '', accountId: '', country: 'global' })
  })

  it.each([
    [{ error: 4 }, 'Privacy policy error'],
    [{ error: 2 }, 'Invalid credentials - Please check your username and password.'],
    [{ error: 9 }, 'Authentication failed'],
    [null, 'Unknown Error Occurred'],
  ])('reports %p', async (answer, message) => {
    ;(getAuthToken as jest.Mock).mockResolvedValue(answer)
    at('/login', [['/login', <LoginPage />]])
    await fill()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  })

  it.each([
    [{ response: { status: 500, statusText: 'Oops' } }, 'Server error (500): Oops'],
    [{ response: { status: 502 } }, 'Server error (502): Unknown error'],
    [{ request: {} }, 'Unable to connect to server. Please check your internet connection.'],
    [{ code: 'ECONNABORTED' }, 'Request timeout. Please try again.'],
    [{ message: 'Network Error' }, 'Network error. Please check your internet connection.'],
    [{ message: 'weird' }, 'An unexpected error occurred. Please try again.'],
  ])('maps the failure %p to a toast', async (err, message) => {
    ;(getAuthToken as jest.Mock).mockRejectedValue(err)
    at('/login', [['/login', <LoginPage />]])
    await fill()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  })

  it('stores the language chosen in the dropdown and the credentials hint opens', async () => {
    at('/login', [['/login', <LoginPage />]])
    const triggers = screen.getAllByRole('combobox')
    await pick(triggers[0], 'English')
    expect(useAuthStore.getState().language).toBe('en')
    await pick(screen.getAllByRole('combobox')[1], 'Germany')
    fireEvent.click(screen.getAllByRole('button').find((b) => b.querySelector('svg') && !b.textContent)!)
    expect(await screen.findByText(/Connected Apps/)).toBeInTheDocument()
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
  let reload: jest.Mock
  const realLocation = window.location
  beforeEach(() => {
    ipc = stubElectron()
    reload = jest.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
    useAlertStore.setState({ bringToFrontEnabled: false, flashWindowEnabled: false, audioAlertEnabled: false, useCustomSound: false })
  })
  afterEach(() => Object.defineProperty(window, 'location', { configurable: true, value: realLocation }))

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
    expect(reload).toHaveBeenCalled()
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

  it('reveals the sound options as alerts are switched on', async () => {
    open()
    const boxes = () => screen.getAllByRole('checkbox')
    fireEvent.click(boxes()[1])
    fireEvent.click(boxes()[2])
    fireEvent.click(boxes()[3])
    expect(useAlertStore.getState()).toMatchObject({ bringToFrontEnabled: true, flashWindowEnabled: true, audioAlertEnabled: true })
    fireEvent.click(boxes()[4])
    expect(useAlertStore.getState().useCustomSound).toBe(true)
    expect(screen.getByText('Upload Sound')).toBeInTheDocument()
  })

  describe('custom sound upload', () => {
    let input: HTMLInputElement
    beforeEach(() => {
      useAlertStore.setState({ audioAlertEnabled: true, useCustomSound: true })
      const create = document.createElement.bind(document)
      jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = create(tag)
        if (tag === 'input') {
          input = el as HTMLInputElement
          jest.spyOn(el, 'click').mockImplementation(() => {})
        }
        return el
      })
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
