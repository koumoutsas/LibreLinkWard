import { Connection, GraphPoint, GraphResult, LinkUpError } from '../../shared/linkup'
import { HISTORY_WINDOW_MS } from '../../shared/stores'
import { NightscoutClient } from './client'

/** Id of the single patient a Nightscout site provides. */
export const NIGHTSCOUT_PATIENT_ID = 'nightscout'

// Nightscout direction -> LibreLinkUp TrendArrow 1..5 (double arrows are folded in).
const TRENDS: Record<string, number> = {
  DoubleDown: 1,
  SingleDown: 1,
  FortyFiveDown: 2,
  Flat: 3,
  FortyFiveUp: 4,
  SingleUp: 5,
  DoubleUp: 5,
}

/** Null for anything that is not a usable sgv entry. */
export function entryToPoint(raw: any): GraphPoint | null {
  const date = Number(raw?.date)
  const sgv = Number(raw?.sgv)
  if (!Number.isFinite(date) || !Number.isFinite(sgv) || sgv <= 0) return null
  const iso = new Date(date).toISOString()
  return {
    Timestamp: iso,
    FactoryTimestamp: iso,
    ValueInMgPerDl: sgv,
    Value: sgv,
    TrendArrow: raw.direction ? TRENDS[raw.direction] : undefined,
  }
}

export type NightscoutSourceOptions = {
  client: Pick<NightscoutClient, 'entriesSince'>
  name: string
  now?: () => number
}

const asLinkUpError = (e: any): LinkUpError => {
  if (e instanceof LinkUpError) return e
  const status: number | undefined = e?.response?.status
  const auth = status === 401 || status === 403
  const msg = auth
    ? 'Nightscout rejected the API secret'
    : status === 429
      ? 'Nightscout is rate limiting requests'
      : e?.message ?? String(e)
  return new LinkUpError(msg, auth ? 'auth' : status === 429 ? 'rate-limit' : 'network', status)
}

/**
 * Presents a Nightscout site through the same two calls the Poller uses for
 * LibreLinkUp, so it feeds the patient store like any other login.
 */
export class NightscoutSource {
  constructor(private readonly opts: NightscoutSourceOptions) {}

  async getConnections(): Promise<Connection[]> {
    return [{ patientId: NIGHTSCOUT_PATIENT_ID, firstName: this.opts.name }]
  }

  async getGraph(patientId: string): Promise<GraphResult> {
    const since = (this.opts.now ?? Date.now)() - HISTORY_WINDOW_MS
    let raw: unknown[]
    try {
      raw = await this.opts.client.entriesSince(since)
    } catch (e) {
      throw asLinkUpError(e)
    }
    const graphData = raw
      .map(entryToPoint)
      .filter((p): p is GraphPoint => p !== null)
      .sort((a, b) => Date.parse(a.Timestamp) - Date.parse(b.Timestamp))
    return {
      connection: { patientId, firstName: this.opts.name },
      graphData,
      glucoseMeasurement: graphData[graphData.length - 1],
    }
  }
}
