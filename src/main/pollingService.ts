import { Connection, Credentials, GraphResult, LinkUpClient, LinkUpError, Poller } from '../shared/linkup'
import type { PatientStore } from '../shared/stores'
import { CredentialStore, StoredAccount, accountIdFor } from './credentialStore'

export type ServiceStatus = 'signed-out' | 'running' | 'auth-error'

export type AccountStatus = 'running' | 'auth-error'

/** What the renderer is told about each login; never the password. */
export type AccountInfo = { id: string; username: string; status: AccountStatus }

export type PollingServiceDeps = {
  credentials: CredentialStore
  patients: PatientStore
  /** Called whenever status changes, for pushing to the renderer. */
  onStatus?: (status: ServiceStatus) => void
  createClient?: (credentials: Credentials) => LinkUpClient
  intervalMs?: number
}

/**
 * Owns one LibreLinkUp client + poller per login in the main process and
 * feeds the patient store. Each login (a patient's own credentials, or a
 * follower account with several patients) is an independent view.
 */
export class PollingService {
  private readonly pollers = new Map<string, Poller>()
  private readonly accounts = new Map<string, StoredAccount>()
  private readonly accountStatus = new Map<string, AccountStatus>()
  private readonly createClient: (c: Credentials) => LinkUpClient

  constructor(private readonly deps: PollingServiceDeps) {
    this.createClient = deps.createClient ?? ((credentials) => new LinkUpClient({ credentials }))
  }

  getStatus(): ServiceStatus {
    if (this.accounts.size === 0) return 'signed-out'
    return [...this.accountStatus.values()].includes('auth-error') ? 'auth-error' : 'running'
  }

  getAccounts(): AccountInfo[] {
    return [...this.accounts.values()].map((a) => ({
      id: a.id,
      username: a.username,
      status: this.accountStatus.get(a.id) ?? 'running',
    }))
  }

  /** Starts polling every stored login, if any. */
  startIfConfigured(): boolean {
    const stored = this.deps.credentials.loadAll()
    for (const account of stored) this.begin(account)
    return stored.length > 0
  }

  /**
   * Verifies the credentials with a real login, then stores them and polls.
   * Adding a login that already exists replaces it.
   */
  async signIn(credentials: Credentials): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
    const client = this.createClient(credentials)
    let country: string
    try {
      country = (await client.login()).country
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        status: e instanceof LinkUpError ? e.status : undefined,
      }
    }
    const account: StoredAccount = { ...credentials, country, id: accountIdFor(credentials.username) }
    try {
      const others = [...this.accounts.values()].filter((a) => a.id !== account.id)
      this.deps.credentials.saveAll([...others, account])
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    this.begin(account, client)
    return { ok: true }
  }

  /** Removes one login and all of its patients. */
  removeAccount(id: string): void {
    if (!this.accounts.has(id)) return
    this.halt(id)
    this.accounts.delete(id)
    this.accountStatus.delete(id)
    this.deps.credentials.saveAll([...this.accounts.values()])
    this.deps.patients.getState().removeAccount(id)
    this.notify()
  }

  signOut(): void {
    for (const id of [...this.pollers.keys()]) this.halt(id)
    this.accounts.clear()
    this.accountStatus.clear()
    this.deps.credentials.clear()
    this.deps.patients.getState().clear()
    this.notify()
  }

  stop(): void {
    for (const id of [...this.pollers.keys()]) this.halt(id)
  }

  private begin(account: StoredAccount, client = this.createClient(account)): void {
    this.halt(account.id)
    this.accounts.set(account.id, account)
    this.accountStatus.set(account.id, 'running')
    const store = this.deps.patients.getState()
    const poller = new Poller({
      client,
      intervalMs: this.deps.intervalMs,
      onConnections: (c: Connection[]) => store.applyConnections(c, account.id),
      onUpdate: (id: string, graph: GraphResult) => store.applyGraph(id, graph),
      onError: (error, patientId) => this.handleError(account.id, error, patientId),
    })
    this.pollers.set(account.id, poller)
    this.notify()
    poller.start()
  }

  private handleError(accountId: string, error: unknown, patientId?: string): void {
    // Bad credentials will not fix themselves: stop instead of hammering the API.
    if (error instanceof LinkUpError && error.kind === 'auth') {
      this.halt(accountId)
      this.accountStatus.set(accountId, 'auth-error')
      this.notify()
      return
    }
    if (patientId) {
      this.deps.patients
        .getState()
        .setError(patientId, error instanceof Error ? error.message : String(error))
    }
  }

  private halt(id: string): void {
    this.pollers.get(id)?.stop()
    this.pollers.delete(id)
  }

  private notify(): void {
    this.deps.onStatus?.(this.getStatus())
  }
}
