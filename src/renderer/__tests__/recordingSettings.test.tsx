import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PatientRecordingSettings } from '../components/patient-recording-settings'
import { PatientCard } from '../components/patient-card'
import { stubBrowser, stubElectron } from './helpers/electron'

beforeAll(stubBrowser)

const base = { sid: 'linkup:p1', enabled: false, hasBlob: false, status: { queued: 0 } }

describe('PatientRecordingSettings', () => {
  it('shows the sid with a copy button and no switch before a config is pasted', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    stubElectron(async () => base)
    render(<PatientRecordingSettings patientId="a~p1" />)
    expect(await screen.findByTestId('recording-sid')).toHaveTextContent('linkup:p1')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('linkup:p1'))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('saves a pasted config and reports a rejected one', async () => {
    let state = base
    const ipc = stubElectron(async (ch, _k, blob) => {
      if (ch === 'recording:set-blob') {
        if (blob === 'bad') return { ok: false, error: 'issued for linkup:other' }
        state = { ...base, hasBlob: true, install: 'desk', region: 'eu-west-1', stream: 's' } as typeof base
        return { ok: true }
      }
      return state
    })
    render(<PatientRecordingSettings patientId="a~p1" />)
    const input = await screen.findByLabelText('Recording config')
    fireEvent.change(input, { target: { value: 'bad' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText(/Not saved: issued for linkup:other/)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'good' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText(/Configured for desk/)).toBeInTheDocument()
    expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('recording:set-blob', 'a~p1', 'good')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('toggles recording, tests, removes, and shows status and errors', async () => {
    const state = {
      ...base,
      hasBlob: true,
      enabled: true,
      install: 'desk',
      status: { queued: 3, lastSent: Date.now(), lastError: 'AccessDenied', halted: true },
    }
    const ipc = stubElectron(async (ch) => {
      if (ch === 'recording:test') return { ok: false, error: 'denied' }
      return state
    })
    const { emit } = ipc
    render(<PatientRecordingSettings patientId="a~p1" />)
    expect(await screen.findByText(/3 waiting/)).toBeInTheDocument()
    expect(screen.getByText(/Recording stopped: AccessDenied/)).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('checkbox')))
    expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('recording:set-enabled', 'a~p1', false)
    fireEvent.click(screen.getByText('Test connection'))
    expect(await screen.findByText('Failed: denied')).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByText('Remove config')))
    expect(ipc.ipcRenderer.invoke).toHaveBeenCalledWith('recording:clear', 'a~p1')
    await act(async () => emit('recording:changed'))
  })
})

describe('PatientCard recording indicator', () => {
  const patient = { patientId: 'a~p1', name: 'P', history: [], status: 'ok' as const }

  it('is hidden when not recording and flags problems', () => {
    stubElectron(async () => undefined)
    const { rerender } = render(<PatientCard patient={patient} onOpen={() => {}} />)
    expect(screen.queryByTestId('recording-indicator')).not.toBeInTheDocument()
    rerender(<PatientCard patient={patient} onOpen={() => {}} recording="problem" />)
    expect(screen.getByTestId('recording-indicator')).toHaveAttribute('title', expect.stringContaining('problem'))
  })
})
