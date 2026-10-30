import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PatientAlarms } from '../components/patient-alarms'
import { NightscoutSettings } from '../components/nightscout-settings'
import { NightscoutSiteSettings } from '../components/nightscout-site-settings'
import { useAuthStore } from '../stores/auth'
import { stubBrowser, stubElectron } from './helpers/electron'

beforeAll(stubBrowser)

describe('PatientAlarms', () => {
  const config = { enabled: true, urgentLow: 54, low: 70, high: 180, urgentHigh: 250, signalLossMinutes: 20, sound: true }
  let ipc: ReturnType<typeof stubElectron>
  beforeEach(() => {
    useAuthStore.setState({ resultUnit: 'mg/dL' })
    let current = config
    ipc = stubElectron(async (ch, _id, patch) => {
      if (ch === 'alarms:set') current = { ...current, ...patch }
      return ch === 'alarms:get' ? current : undefined
    })
  })

  it('renders nothing until the config arrives, then shows the fields', async () => {
    render(<PatientAlarms patientId="p" />)
    expect(await screen.findByLabelText('Low')).toHaveValue(70)
    expect(screen.getByLabelText('Signal loss minutes')).toHaveValue(20)
  })

  it('keeps Save disabled until something changes and saves a patch in the shown unit', async () => {
    render(<PatientAlarms patientId="p" />)
    const save = await screen.findByText('Save')
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Low'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Signal loss minutes'), { target: { value: '30' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(save)
    await waitFor(() =>
      expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('alarms:set', 'p', {
        enabled: false,
        sound: false,
        low: 80,
        signalLossMinutes: 30,
      }),
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('converts mmol/L back to mg/dL when saving', async () => {
    useAuthStore.setState({ resultUnit: 'mmol/L' })
    render(<PatientAlarms patientId="p" />)
    fireEvent.change(await screen.findByLabelText('High'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('alarms:set', 'p', { high: expect.any(Number) }),
    )
    const patch = ipc.ipcRenderer.invoke.mock.calls.find((c) => c[0] === 'alarms:set')![2]
    expect(patch.high).toBeGreaterThan(210)
    expect(patch.high).toBeLessThan(225)
  })

  it.each([
    ['Low', '', 'Low must be a positive number'],
    ['High', '-3', 'High must be a positive number'],
  ])('rejects an invalid %s threshold', async (label, value, message) => {
    render(<PatientAlarms patientId="p" />)
    fireEvent.change(await screen.findByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(ipc.ipcRenderer.invoke).not.toHaveBeenCalledWith('alarms:set', expect.anything(), expect.anything())
    fireEvent.change(screen.getByLabelText(label), { target: { value: '90' } })
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })

  it('rejects an invalid signal loss value', async () => {
    render(<PatientAlarms patientId="p" />)
    fireEvent.change(await screen.findByLabelText('Signal loss minutes'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText('Signal loss must be a positive number of minutes')).toBeInTheDocument()
  })

  it('resets to sensor defaults and refreshes on alarms:changed', async () => {
    render(<PatientAlarms patientId="p" />)
    fireEvent.click(await screen.findByText('Reset to sensor defaults'))
    expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('alarms:reset', 'p')
    ipc.ipcRenderer.invoke.mockImplementation(async (ch: string) => (ch === 'alarms:get' ? { ...config, low: 65 } : undefined))
    act(() => ipc.emit('alarms:changed'))
    await waitFor(() => expect(screen.getByLabelText('Low')).toHaveValue(65))
  })
})

describe('NightscoutSettings', () => {
  const state = { enabled: false, url: 'https://ns.example', deviceName: 'dev', hasSecret: true, status: {} as any }
  let ipc: ReturnType<typeof stubElectron>
  beforeEach(() => {
    ipc = stubElectron(async (ch) => {
      if (ch === 'nightscout:get') return state
      if (ch === 'nightscout:reveal-secret') return 'stored-secret'
      if (ch === 'nightscout:test') return { ok: false, error: 'bad' }
      return undefined
    })
  })

  it('shows the stored settings and saves edits, blank secret kept', async () => {
    render(<NightscoutSettings patientId="p" />)
    const url = await screen.findByLabelText('Nightscout URL')
    expect(url).toHaveValue('https://ns.example')
    expect(screen.getByText('Save')).toBeDisabled()
    fireEvent.change(url, { target: { value: 'https://other.example' } })
    fireEvent.change(screen.getByLabelText('Nightscout device name'), { target: { value: 'd2' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('nightscout:set', 'p', {
        url: 'https://other.example',
        deviceName: 'd2',
      }),
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('sends a typed secret, reveals the stored one and hides it again', async () => {
    render(<NightscoutSettings patientId="p" />)
    const secret = await screen.findByLabelText('Nightscout API secret')
    expect(secret).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByLabelText('Show API secret'))
    await waitFor(() => expect(secret).toHaveValue('stored-secret'))
    expect(secret).toHaveAttribute('type', 'text')
    expect(screen.getByText('Save')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Hide API secret'))
    expect(secret).toHaveValue('')
    fireEvent.change(secret, { target: { value: 'new' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('nightscout:set', 'p', expect.objectContaining({ apiSecret: 'new' })),
    )
  })

  it('toggles upload and reports test results and upload status', async () => {
    render(<NightscoutSettings patientId="p" />)
    fireEvent.click(await screen.findByRole('checkbox'))
    await waitFor(() =>
      expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('nightscout:set', 'p', expect.objectContaining({ enabled: true })),
    )
    fireEvent.click(screen.getByText('Test connection'))
    expect(await screen.findByText('Failed: bad')).toBeInTheDocument()
    ipc.ipcRenderer.invoke.mockImplementation(async (ch: string) =>
      ch === 'nightscout:test' ? { ok: true } : { ...state, status: { lastUploaded: 1700000000000, lastError: 'boom' } },
    )
    fireEvent.click(screen.getByText('Test connection'))
    expect(await screen.findByText('Connection OK')).toBeInTheDocument()
    act(() => ipc.emit('nightscout:changed'))
    expect(await screen.findByText(/Last reading uploaded/)).toBeInTheDocument()
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })

  it('does not reveal a secret when none is stored', async () => {
    ipc.ipcRenderer.invoke.mockImplementation(async () => ({ ...state, hasSecret: false }))
    render(<NightscoutSettings patientId="p" />)
    fireEvent.click(await screen.findByLabelText('Show API secret'))
    expect(ipc.ipcRenderer.invoke).not.toHaveBeenCalledWith('nightscout:reveal-secret', 'p')
  })
})

describe('NightscoutSiteSettings', () => {
  const account = { id: 'a1', username: 'Home', kind: 'nightscout' as const, status: 'running' as const, url: 'https://ns.example', hasSecret: true }
  let ipc: ReturnType<typeof stubElectron>
  let result: any
  beforeEach(() => {
    result = { ok: true }
    ipc = stubElectron(async (ch) => (ch === 'linkup:update-nightscout' ? result : 'stored'))
  })

  it('saves trimmed values and confirms', async () => {
    render(<NightscoutSiteSettings account={account} />)
    expect(screen.getByText('Save')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Nightscout site URL'), { target: { value: ' https://new.example ' } })
    fireEvent.change(screen.getByLabelText('Nightscout patient name'), { target: { value: ' Kid ' } })
    fireEvent.change(screen.getByLabelText('Nightscout site API secret'), { target: { value: 's' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('linkup:update-nightscout', 'a1', {
        url: 'https://new.example',
        name: 'Kid',
        apiSecret: 's',
      }),
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it.each([
    [{ ok: false, error: 'nope' }, 'Connection failed: nope'],
    [undefined, 'Connection failed: unknown error'],
  ])('shows a failed check (%p)', async (res, text) => {
    result = res
    render(<NightscoutSiteSettings account={account} />)
    fireEvent.change(screen.getByLabelText('Nightscout patient name'), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText(text)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nightscout patient name'), { target: { value: 'y' } })
    expect(screen.queryByText(text)).not.toBeInTheDocument()
  })

  it('disables Save with an empty URL and handles secret reveal/hide', async () => {
    render(<NightscoutSiteSettings account={account} />)
    fireEvent.change(screen.getByLabelText('Nightscout site URL'), { target: { value: ' ' } })
    expect(screen.getByText('Save')).toBeDisabled()
    const secret = screen.getByLabelText('Nightscout site API secret')
    fireEvent.click(screen.getByLabelText('Show API secret'))
    await waitFor(() => expect(secret).toHaveValue('stored'))
    fireEvent.click(screen.getByLabelText('Hide API secret'))
    expect(secret).toHaveValue('')
  })

  it('does not ask for a secret when none is stored', async () => {
    render(<NightscoutSiteSettings account={{ ...account, hasSecret: false, url: undefined }} />)
    fireEvent.click(screen.getByLabelText('Show API secret'))
    expect(ipc.ipcRenderer.invoke).not.toHaveBeenCalled()
  })
})
