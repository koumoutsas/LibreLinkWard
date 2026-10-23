import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DashboardPage from '../pages/dashboard'
import { GraphTooltip } from '../components/patient-graph'
import { useAuthStore } from '../stores/auth'
import '../i18n/config'

const point = (v: number, minsAgo = 0) => {
  const ts = new Date(Date.now() - minsAgo * 60000).toISOString()
  return { Timestamp: ts, FactoryTimestamp: ts, ValueInMgPerDl: v, TrendArrow: 3 }
}
const patient = (id: string, name: string, v: number) => ({
  patientId: id,
  name,
  targetLow: 70,
  targetHigh: 180,
  history: [point(v, 10), point(v, 0)],
  latest: point(v),
  status: 'ok',
  lastUpdated: Date.now(),
})
const config = { enabled: true, urgentLow: 55, low: 70, high: 180, urgentHigh: 250, signalLossMinutes: 20, sound: true }

beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as any
  ;(global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  useAuthStore.setState({ resultUnit: 'mg/dL', token: 't' })
  ;(window as any).electron = {
    ipcRenderer: {
      on: jest.fn(() => jest.fn()),
      sendMessage: jest.fn(),
      once: jest.fn(),
      invoke: jest.fn(async (channel: string) =>
        channel === 'linkup:get-state'
          ? {
              status: 'running',
              patients: [patient('a', 'Alice', 50), patient('b', 'Bob', 120), patient('c', 'Cleo', 300)],
            }
          : config,
      ),
    },
  }
})

const renderDashboard = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/patients/:id" element={<div>detail page</div>} />
      </Routes>
    </MemoryRouter>,
  )

describe('dashboard', () => {
  it('shows one card per patient with value and level colour', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('patient-card-a')).toBeInTheDocument())
    expect(screen.getByTestId('patient-card-b')).toHaveTextContent('Bob')
    expect(screen.getByTestId('patient-card-b')).toHaveTextContent('120')
    await waitFor(() => expect(screen.getByTestId('patient-card-a').firstElementChild).toHaveClass('bg-red-600'))
    expect(screen.getByTestId('patient-card-b').firstElementChild).toHaveClass('bg-green-600')
    expect(screen.getByTestId('patient-card-c').firstElementChild).toHaveClass('bg-red-600')
  })

  it('opens the patient detail page on click', async () => {
    renderDashboard()
    fireEvent.click(await screen.findByTestId('patient-card-b'))
    expect(await screen.findByText('detail page')).toBeInTheDocument()
  })

  it('shows an empty state without patients', async () => {
    ;(window as any).electron.ipcRenderer.invoke = jest.fn(async () => ({ status: 'running', patients: [] }))
    renderDashboard()
    expect(await screen.findByTestId('no-patients')).toBeInTheDocument()
  })
})

describe('several logins', () => {
  const withAccounts = () => {
    const invoke = jest.fn<Promise<any>, [string, ...unknown[]]>(async (channel: string) =>
      channel === 'linkup:get-state'
        ? {
            status: 'running',
            accounts: [
              { id: 'ann', username: 'ann@example.com', status: 'running' },
              { id: 'bob', username: 'bob@example.com', status: 'running' },
            ],
            patients: [
              { ...patient('a', 'Alice', 100), accountId: 'ann' },
              { ...patient('b', 'Bob', 120), accountId: 'bob' },
            ],
          }
        : config,
    )
    ;(window as any).electron.ipcRenderer.invoke = invoke
    return invoke
  }

  it('stacks one section per login, each with its own patient', async () => {
    withAccounts()
    renderDashboard()
    const ann = await screen.findByTestId('account-ann')
    const bob = screen.getByTestId('account-bob')
    expect(ann).toHaveTextContent('ann@example.com')
    expect(ann).toHaveTextContent('Alice')
    expect(ann).not.toHaveTextContent('Bob')
    expect(bob).toHaveTextContent('Bob')
    expect(ann.compareDocumentPosition(bob) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('removes a login', async () => {
    const invoke = withAccounts()
    renderDashboard()
    fireEvent.click(await screen.findByLabelText('Remove bob@example.com'))
    expect(invoke).toHaveBeenCalledWith('linkup:remove-account', 'bob')
  })

  it('adds a login through the form', async () => {
    const invoke = withAccounts()
    invoke.mockImplementation(async (channel: string) =>
      channel === 'linkup:sign-in' ? { ok: true } : channel === 'linkup:get-state' ? { status: 'running', accounts: [], patients: [] } : config,
    )
    renderDashboard()
    fireEvent.click(await screen.findByLabelText('Add patient'))
    fireEvent.change(screen.getByPlaceholderText('Patient username (email)'), { target: { value: 'pat@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } })
    fireEvent.submit(screen.getByTestId('add-patient-form'))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('linkup:sign-in', { username: 'pat@example.com', password: 'pw', country: 'global' }),
    )
  })
})

describe('graph tooltip', () => {
  it('shows value, unit and time of the hovered point', () => {
    const t = Date.parse('2026-01-01T10:30:00Z')
    render(<GraphTooltip active unit="mg/dL" payload={[{ payload: { t, mgdl: 142, value: 142 } }] as any} />)
    const tip = screen.getByTestId('graph-tooltip')
    expect(tip).toHaveTextContent('142 mg/dL')
    expect(tip).toHaveTextContent(/\d{1,2}:\d{2}/)
  })
  it('renders nothing when inactive', () => {
    const { container } = render(<GraphTooltip active={false} unit="mg/dL" payload={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('alarm banner', () => {
  const active = [
    { patientId: 'a', name: 'Alice', kind: 'urgent-low', value: 50, since: 1, acknowledged: false },
    { patientId: 'c', name: 'Cleo', kind: 'high', value: 300, since: 2, acknowledged: true },
  ]

  it('names each patient and sends per-patient acknowledge and snooze', async () => {
    const invoke = (window as any).electron.ipcRenderer.invoke as jest.Mock
    const base = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) =>
      channel === 'alarms:get-active' ? active : base(channel, ...args),
    )
    renderDashboard()
    const alice = await screen.findByTestId('alarm-a')
    expect(alice).toHaveTextContent('Alice — Urgent low: 50 mg/dL')
    expect(screen.getByTestId('alarm-c')).toHaveTextContent('Cleo — High: 300 mg/dL (acknowledged)')
    expect(screen.getAllByText('Acknowledge')).toHaveLength(1)

    fireEvent.click(screen.getByText('Acknowledge'))
    expect(invoke).toHaveBeenCalledWith('alarms:acknowledge', 'a')
    fireEvent.click(screen.getAllByText('Snooze 30m')[1])
    expect(invoke).toHaveBeenCalledWith('alarms:snooze', 'c', 30)
  })

  it('renders nothing when no alarm is active', async () => {
    renderDashboard()
    await screen.findByTestId('patient-card-a')
    expect(screen.queryByTestId('alarm-banner')).not.toBeInTheDocument()
  })
})
