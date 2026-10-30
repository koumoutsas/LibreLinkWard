import { Connection, Credentials, GraphResult, LinkUpClient, LinkUpError, Poller } from '../shared/linkup'
import type { PatientStore } from '../shared/stores'
import { randomUUID } from 'crypto'
import { CredentialStore, NightscoutAccount, StoredAccount } from './credentialStore'
import { NightscoutClient } from './nightscout/client'
import { NightscoutSource } from './nightscout/source'

export type ServiceStatus = 'signed-out' | 'running' | 'auth-error'

export type AccountStatus = 'running' | 'auth-error'

/** What the renderer is told about each login; never the password. */
export type AccountInfo = {
  id: string
  /** The login name, or the Nightscout site's display name. */
  username: string
  kind: 'linkup' | 'nightscout'
  status: AccountStatus
  /** Nightscout sites only; the secret itself is never included. */
  url?: string
  hasSecret?: boolean
}

type ReadingSource = Pick<LinkUpClient, 'getConnections' | 'getGraph'>

export type PollingServiceDeps = {
  credentials: CredentialStore
  patients: PatientStore
  /** Called whenever status changes, for pushing to the renderer. */
  onStatus?: (status: ServiceStatus) => void
  createClient?: (credentials: Credentials) => LinkUpClient
  /** Reader for a Nightscout site; injectable for tests. */
  createNightscout?: (account: NightscoutAccount) => ReadingSource & { check?: () => Promise<void> }
  intervalMs?: number
  /** Id generator for new logins; injectable for tests. */
  newId?: () => string
}

const URL_ERROR = 'The URL must start with http:// or https://'

/** The site URL without trailing slashes, or undefined when it is not http(s). */
const normalizeUrl = (raw: string) => {
  const url = raw.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(url) ? url : undefined
}

/**
 * Store key of a patient as seen through one login. The same patient reached
 * through two logins (or the same login added twice) is two independent views,
 * each with its own alarms and Nightscout settings.
 */
export const viewKey = (accountId: string, patientId: string) => `${accountId}~${patientId}`

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
      username: a.kind === 'nightscout' ? a.name : a.username,
      kind: a.kind === 'nightscout' ? 'nightscout' : 'linkup',
      status: this.accountStatus.get(a.id) ?? 'running',
      ...(a.kind === 'nightscout' && { url: a.url, hasSecret: !!a.apiSecret }),
    }))
  }

  /** Starts polling every stored login, if any. */
  async startIfConfigured(): Promise<boolean> {
    const stored = await this.deps.credentials.loadAll()
    for (const account of stored) this.begin(account)
    return stored.length > 0
  }

  /**
   * Verifies the credentials with a real login, then stores them and polls.
   * Every call adds a new view, even for credentials that were added before.
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
    const account: StoredAccount = { ...credentials, country, id: (this.deps.newId ?? randomUUID)() }
    try {
      await this.deps.credentials.saveAll([...this.accounts.values(), account])
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    this.begin(account, client)
    return { ok: true }
  }

  /** Verifies a Nightscout site, then stores it and polls it as a patient. */
  async addNightscout(input: {
    url: string
    apiSecret?: string
    name?: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const url = normalizeUrl(input.url)
    if (!url) return { ok: false, error: URL_ERROR }
    const account: NightscoutAccount = {
      id: (this.deps.newId ?? randomUUID)(),
      kind: 'nightscout',
      url,
      apiSecret: input.apiSecret ?? '',
      name: input.name?.trim() || new URL(url).host,
    }
    try {
      await new NightscoutClient(account).testConnection()
      await this.deps.credentials.saveAll([...this.accounts.values(), account])
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    this.begin(account)
    return { ok: true }
  }

  /**
   * Changes a Nightscout site's URL, secret or name after checking the new
   * settings. A blank secret keeps the stored one. The view keeps its id, so
   * its alarms and Nightscout settings survive; a rejected secret is cleared.
   */
  async updateNightscout(
    id: string,
    input: { url: string; apiSecret?: string; name?: string },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const prev = this.accounts.get(id)
    if (prev?.kind !== 'nightscout') return { ok: false, error: 'Unknown Nightscout site' }
    const url = normalizeUrl(input.url)
    if (!url) return { ok: false, error: URL_ERROR }
    const account: NightscoutAccount = {
      ...prev,
      url,
      apiSecret: input.apiSecret || prev.apiSecret,
      name: input.name?.trim() || new URL(url).host,
    }
    try {
      await new NightscoutClient(account).testConnection()
      await this.deps.credentials.saveAll([...this.accounts.values()].map((a) => (a.id === id ? account : a)))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    this.begin(account)
    return { ok: true }
  }

  /** The stored secret of a Nightscout site, for an explicit reveal in settings. */
  getNightscoutSecret(id: string): string {
    const a = this.accounts.get(id)
    return a?.kind === 'nightscout' ? a.apiSecret : ''
  }

  /** Removes one login and all of its patients. */
  async removeAccount(id: string): Promise<void> {
    if (!this.accounts.has(id)) return
    this.halt(id)
    this.accounts.delete(id)
    this.accountStatus.delete(id)
    this.deps.patients.getState().removeAccount(id)
    this.notify()
    await this.deps.credentials.saveAll([...this.accounts.values()])
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

  private source(account: StoredAccount): ReadingSource {
    if (account.kind !== 'nightscout') return this.createClient(account)
    return (
      this.deps.createNightscout?.(account) ??
      new NightscoutSource({ client: new NightscoutClient(account), name: account.name })
    )
  }

  private begin(account: StoredAccount, client: ReadingSource = this.source(account)): void {
    this.halt(account.id)
    this.accounts.set(account.id, account)
    this.accountStatus.set(account.id, 'running')
    const store = this.deps.patients.getState()
    const poller = new Poller({
      client,
      intervalMs: this.deps.intervalMs,
      onConnections: (c: Connection[]) =>
        store.applyConnections(
          c.map((x) => ({ ...x, patientId: viewKey(account.id, x.patientId) })),
          account.id,
        ),
      onUpdate: (id: string, graph: GraphResult) => store.applyGraph(viewKey(account.id, id), graph),
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
        .setError(viewKey(accountId, patientId), error instanceof Error ? error.message : String(error))
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
