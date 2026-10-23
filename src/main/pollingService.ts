import { Connection, Credentials, GraphResult, LinkUpClient, LinkUpError, Poller } from '../shared/linkup'
import type { PatientStore } from '../shared/stores'
import { CredentialStore } from './credentialStore'

export type ServiceStatus = 'signed-out' | 'running' | 'auth-error'

export type PollingServiceDeps = {
  credentials: CredentialStore
  patients: PatientStore
  /** Called whenever status changes, for pushing to the renderer. */
  onStatus?: (status: ServiceStatus) => void
  createClient?: (credentials: Credentials) => LinkUpClient
  intervalMs?: number
}

/**
 * Owns the single LibreLinkUp client + poller in the main process and feeds
 * the patient store.
 */
export class PollingService {
  private poller?: Poller
  private status: ServiceStatus = 'signed-out'
  private readonly createClient: (c: Credentials) => LinkUpClient

  constructor(private readonly deps: PollingServiceDeps) {
    this.createClient = deps.createClient ?? ((credentials) => new LinkUpClient({ credentials }))
  }

  getStatus(): ServiceStatus {
    return this.status
  }

  /** Starts polling with stored credentials, if any. */
  startIfConfigured(): boolean {
    const credentials = this.deps.credentials.load()
    if (!credentials) return false
    this.begin(credentials)
    return true
  }

  /** Verifies the credentials with a real login, then stores them and polls. */
  async signIn(credentials: Credentials): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
    const client = this.createClient(credentials)
    try {
      const session = await client.login()
      this.deps.credentials.save({ ...credentials, country: session.country })
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        status: e instanceof LinkUpError ? e.status : undefined,
      }
    }
    this.begin({ ...credentials, country: client.getSession()!.country }, client)
    return { ok: true }
  }

  signOut(): void {
    this.halt()
    this.deps.credentials.clear()
    this.deps.patients.getState().clear()
    this.setStatus('signed-out')
  }

  stop(): void {
    this.halt()
  }

  private begin(credentials: Credentials, client = this.createClient(credentials)): void {
    this.halt()
    const store = this.deps.patients.getState()
    this.poller = new Poller({
      client,
      intervalMs: this.deps.intervalMs,
      onConnections: (c: Connection[]) => store.applyConnections(c),
      onUpdate: (id: string, graph: GraphResult) => store.applyGraph(id, graph),
      onError: (error, patientId) => this.handleError(error, patientId),
    })
    this.setStatus('running')
    this.poller.start()
  }

  private handleError(error: unknown, patientId?: string): void {
    // Bad credentials will not fix themselves: stop instead of hammering the API.
    if (error instanceof LinkUpError && error.kind === 'auth') {
      this.halt()
      this.setStatus('auth-error')
      return
    }
    if (patientId) {
      this.deps.patients
        .getState()
        .setError(patientId, error instanceof Error ? error.message : String(error))
    }
  }

  private halt(): void {
    this.poller?.stop()
    this.poller = undefined
  }

  private setStatus(status: ServiceStatus): void {
    this.status = status
    this.deps.onStatus?.(status)
  }
}
