import { LinkUpClient } from './client'
import { Connection, GraphResult, LinkUpError } from './types'

export type PollerOptions = {
  client: Pick<LinkUpClient, 'getConnections' | 'getGraph'>
  intervalMs?: number
  maxBackoffMs?: number
  onUpdate: (patientId: string, graph: GraphResult) => void
  onError?: (error: unknown, patientId?: string) => void
  onConnections?: (connections: Connection[]) => void
}

const DEFAULT_INTERVAL = 60_000
const DEFAULT_MAX_BACKOFF = 15 * 60_000

/**
 * Single scheduler: one connections request plus one graph request per
 * patient per tick. Errors double the delay (up to maxBackoffMs); a fully
 * successful tick resets it.
 */
export class Poller {
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private delay: number
  private readonly interval: number
  private readonly maxBackoff: number

  constructor(private readonly opts: PollerOptions) {
    this.interval = opts.intervalMs ?? DEFAULT_INTERVAL
    this.maxBackoff = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF
    this.delay = this.interval
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Runs one polling cycle; returns true if everything succeeded. */
  async tick(): Promise<boolean> {
    let ok = true
    try {
      const connections = await this.opts.client.getConnections()
      this.opts.onConnections?.(connections)
      for (const c of connections) {
        try {
          const graph = await this.opts.client.getGraph(c.patientId)
          this.opts.onUpdate(c.patientId, graph)
        } catch (e) {
          ok = false
          this.opts.onError?.(e, c.patientId)
          if (e instanceof LinkUpError && e.kind === 'rate-limit') break
        }
      }
    } catch (e) {
      ok = false
      this.opts.onError?.(e)
    }
    this.delay = ok
      ? this.interval
      : Math.min(this.delay * 2, this.maxBackoff)
    if (this.running) {
      this.timer = setTimeout(() => void this.tick(), this.delay)
    }
    return ok
  }
}
