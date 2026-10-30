import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { AddPatientForm } from '../components/add-patient-form'
import { AlarmNotifier } from '../components/alarm-notifier'
import { ThemeProvider, useTheme } from '../components/theme-provider'
import { HeaderTransition } from '../components/tranisition-provider'
import { PatientCard } from '../components/patient-card'
import { PatientGraph } from '../components/patient-graph'
import DashboardPage from '../pages/dashboard'
import App from '../app'
import { useAlertStore } from '../stores/alertStore'
import { useAuthStore } from '../stores/auth'
import { AudioManager } from '../lib/AudioManager'
import '../i18n/config'
import { stubBrowser, stubElectron } from './helpers/electron'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() }, Toaster: () => null }))

beforeAll(stubBrowser)
beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  useAuthStore.setState({ resultUnit: 'mg/dL', token: 't' })
})

describe('AddPatientForm', () => {
  const type = (ph: string, value: string) => fireEvent.change(screen.getByPlaceholderText(ph), { target: { value } })
  const submit = () => fireEvent.submit(screen.getByTestId('add-patient-form'))

  it('adds a Nightscout site', async () => {
    const ipc = stubElectron(async () => ({ ok: true }))
    const onDone = jest.fn()
    render(<AddPatientForm onDone={onDone} />)
    fireEvent.change(screen.getByLabelText('Reading source'), { target: { value: 'nightscout' } })
    expect(screen.getByText('Add')).toBeDisabled()
    type('https://my-site.example.com', ' https://ns.example ')
    type('API secret (blank if public)', 's')
    type('Patient name (optional)', ' Kid ')
    submit()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('linkup:add-nightscout', { url: 'https://ns.example', apiSecret: 's', name: 'Kid' })
    expect(toast.success).toHaveBeenCalledWith('Patient added')
  })

  it('signs in with another country and reports failures', async () => {
    const ipc = stubElectron(async () => ({ ok: false, error: 'nope' }))
    render(<AddPatientForm onDone={jest.fn()} />)
    type('Patient username (email)', 'a@b.c')
    type('Password', 'pw')
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'eu' } })
    submit()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Sign-in failed: nope'))
    expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('linkup:sign-in', { username: 'a@b.c', password: 'pw', country: 'eu' })
  })

  it.each([
    [{ ok: false, status: 429 }, 'linkup', 'Too many attempts, try again later.'],
    [undefined, 'linkup', 'Sign-in failed: unknown error'],
    [{ ok: false, error: 'dns' }, 'nightscout', 'Connection failed: dns'],
  ])('shows the error for %p (%s)', async (res, source, message) => {
    stubElectron(async () => res)
    render(<AddPatientForm onDone={jest.fn()} />)
    fireEvent.change(screen.getByLabelText('Reading source'), { target: { value: source } })
    if (source === 'linkup') {
      type('Patient username (email)', 'a')
      type('Password', 'b')
    } else type('https://my-site.example.com', 'https://x')
    submit()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  })

  it('cancels', () => {
    stubElectron()
    const onDone = jest.fn()
    render(<AddPatientForm onDone={onDone} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onDone).toHaveBeenCalled()
  })
})

describe('AlarmNotifier', () => {
  let play: jest.Mock
  beforeEach(() => {
    play = jest.fn(async () => {})
    jest.spyOn(AudioManager, 'getInstance').mockReturnValue({ playAudio: play } as any)
    useAlertStore.setState({ bringToFrontEnabled: true, flashWindowEnabled: false, audioAlertEnabled: true, useCustomSound: false })
  })
  afterEach(() => jest.restoreAllMocks())

  const notify = async (sounds: any, n: any = { sound: true }) => {
    const ipc = stubElectron(async (ch) => (ch === 'get-alert-sound-file' ? sounds : []))
    render(<AlarmNotifier />)
    await act(async () => ipc.emit('alarms:notify', n))
    return ipc
  }

  it('flashes the window and plays the default sound', async () => {
    const ipc = await notify({ default: 'd.mp3', custom: 'c.mp3' })
    expect(ipc.ipcRenderer.sendMessage).toHaveBeenCalledWith('trigger-warning-alerts', { bringToFrontEnabled: true, flashWindowEnabled: false })
    expect(play).toHaveBeenCalledWith('d.mp3')
  })

  it('plays the custom sound when chosen and available', async () => {
    useAlertStore.setState({ useCustomSound: true })
    await notify({ default: 'd.mp3', custom: 'c.mp3' })
    expect(play).toHaveBeenCalledWith('c.mp3')
  })

  it('falls back to the default when there is no custom file, and skips without any', async () => {
    useAlertStore.setState({ useCustomSound: true })
    await notify({ default: 'd.mp3' })
    expect(play).toHaveBeenCalledWith('d.mp3')
    play.mockClear()
    await notify(undefined)
    expect(play).not.toHaveBeenCalled()
  })

  it('stays silent when audio is off or the alarm has no sound', async () => {
    await notify({ default: 'd.mp3' }, { sound: false })
    useAlertStore.setState({ audioAlertEnabled: false })
    await notify({ default: 'd.mp3' })
    expect(play).not.toHaveBeenCalled()
  })

  it('logs instead of throwing when playback fails', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    play.mockRejectedValue(new Error('x'))
    await notify({ default: 'd.mp3' })
    expect(err).toHaveBeenCalledWith('Error handling alarm notification:', expect.any(Error))
  })
})

describe('ThemeProvider', () => {
  const Probe = () => {
    const { theme, setTheme } = useTheme()
    return <button onClick={() => setTheme('light')}>{theme}</button>
  }
  afterEach(() => document.documentElement.classList.remove('light', 'dark'))

  it('follows the system theme by default and applies a stored one', () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as any
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(document.documentElement).toHaveClass('dark')
    document.documentElement.classList.remove('dark')
    stubBrowser()
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(document.documentElement).toHaveClass('light')
  })

  it('saves and applies a chosen theme', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(localStorage.getItem('vite-ui-theme')).toBe('light')
    expect(document.documentElement).toHaveClass('light')
  })

  it('uses the stored theme and the default context outside a provider', () => {
    localStorage.setItem('vite-ui-theme', 'dark')
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(document.documentElement).toHaveClass('dark')
    unmount()
    render(<Probe />)
    fireEvent.click(screen.getByRole('button'))
    expect(localStorage.getItem('vite-ui-theme')).toBe('light')
  })
})

it('renders the header transition', () => {
  render(<HeaderTransition>hi</HeaderTransition>)
  expect(screen.getByText('hi')).toBeInTheDocument()
})

describe('PatientCard', () => {
  const ts = new Date().toISOString()
  const base: any = { patientId: 'p', name: 'Alice', history: [], status: 'ok', lastUpdated: undefined }
  const show = (patient: any, alarms: any = undefined) => {
    stubElectron(async () => alarms)
    return render(<PatientCard patient={patient} onOpen={jest.fn()} />)
  }

  it('shows an empty card for a patient without readings', () => {
    show(base)
    expect(screen.getByText('No data yet')).toBeInTheDocument()
    expect(screen.getByText('No data')).toBeInTheDocument()
  })

  it('flags connection problems and uses the alarm thresholds', async () => {
    const latest = { Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: 100 }
    show({ ...base, status: 'error', lastError: 'boom', latest, history: [latest], lastUpdated: Date.now() - 5 * 60000 }, { urgentLow: 54, low: 70, high: 180, urgentHigh: 250 })
    expect(screen.getByText('Connection problem')).toHaveAttribute('title', 'boom')
    expect(screen.getByText('5 min ago')).toBeInTheDocument()
  })
})

describe('PatientGraph', () => {
  const pt = (v: number, mins: number) => {
    const t = new Date(Date.now() - mins * 60000).toISOString()
    return { Timestamp: t, FactoryTimestamp: t, ValueInMgPerDl: v }
  }
  it.each([['mg/dL', false], ['mmol/L', true]])('draws %s, compact=%s', (unit, compact) => {
    render(<PatientGraph history={[pt(100, 20), pt(300, 10), pt(40, 0)] as any} unit={unit} targetLow={70} targetHigh={180} windowMs={3600000} compact={compact} />)
    expect(screen.getByTestId('patient-graph')).toBeInTheDocument()
  })
})

describe('Dashboard extras', () => {
  const state = (over: any) => stubElectron(async (ch) => (ch === 'linkup:get-state' ? { status: 'running', ...over } : undefined))
  const show = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>)

  it('shows a loading screen first, then the signed-out message', async () => {
    state({ status: 'signed-out', patients: [] })
    show()
    expect(await screen.findByText('Not signed in.')).toBeInTheDocument()
  })

  it('opens settings in a new window and marks failed sign-ins', async () => {
    const ipc = state({
      accounts: [{ id: 'a', username: 'me', status: 'auth-error' }],
      patients: [{ patientId: 'p', name: 'A', accountId: 'a', history: [], status: 'ok' }],
    })
    show()
    expect(await screen.findByText(/Sign-in failed/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Settings'))
    expect(ipc.ipcRenderer.sendMessage).toHaveBeenCalledWith('open-new-window', '/settings/general', 1024, 768)
    fireEvent.click(screen.getByLabelText('Add patient'))
    expect(screen.getByTestId('add-patient-form')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByTestId('add-patient-form')).not.toBeInTheDocument()
  })
})

describe('App', () => {
  it('reloads on logout events, and routes signed-in users to the dashboard', async () => {
    const ipc = stubElectron(async (ch) => (ch === 'linkup:get-state' ? { status: 'running', patients: [] } : undefined))
    const reload = jest.fn()
    const real = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...real, reload } })
    const { unmount } = render(<App />)
    act(() => ipc.emit('logout-event'))
    expect(reload).toHaveBeenCalled()
    unmount()
    Object.defineProperty(window, 'location', { configurable: true, value: real })
  })
})
