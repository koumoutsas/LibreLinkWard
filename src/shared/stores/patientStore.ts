import { createStore } from 'zustand/vanilla'
import { HAS_ZONE } from '../linkup/timestamps'
import { Connection, GraphPoint, GraphResult } from '../linkup/types'

export const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000

export type PatientStatus = 'ok' | 'error'

export type PatientState = {
  patientId: string
  /** The LibreLinkUp login this patient was fetched with (one view per login). */
  accountId?: string
  name: string
  targetLow?: number
  targetHigh?: number
  latest?: GraphPoint
  /** Oldest first, deduplicated by timestamp, limited to HISTORY_WINDOW_MS. */
  history: GraphPoint[]
  status: PatientStatus
  lastError?: string
  /** Epoch ms of the last successful update. */
  lastUpdated?: number
}

export type PatientStoreState = {
  patients: Record<string, PatientState>
  applyConnections: (connections: Connection[], accountId?: string) => void
  applyGraph: (patientId: string, graph: GraphResult, now?: number) => void
  setError: (patientId: string, message: string) => void
  /** Drops every patient that came from this login. */
  removeAccount: (accountId: string) => void
  clear: () => void
}

const displayName = (c: Pick<Connection, 'firstName' | 'lastName' | 'patientId'>) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ') || c.patientId

/**
 * Epoch ms of a reading; NaN when the timestamp cannot be parsed or has no explicit
 * timezone (Z or an offset). A zoneless time is ambiguous, so it is never guessed at.
 */
export const pointTime = (p: GraphPoint): number => {
  const ts = p.FactoryTimestamp ?? p.Timestamp
  return HAS_ZONE.test(ts) ? Date.parse(ts) : NaN
}

export function mergeHistory(
  existing: GraphPoint[],
  incoming: GraphPoint[],
  windowMs = HISTORY_WINDOW_MS,
): GraphPoint[] {
  const byKey = new Map<string, GraphPoint>()
  for (const p of [...existing, ...incoming]) {
    byKey.set(p.FactoryTimestamp ?? p.Timestamp, p)
  }
  const sorted = [...byKey.values()]
    .filter((p) => !Number.isNaN(pointTime(p)))
    .sort((a, b) => pointTime(a) - pointTime(b))
  if (sorted.length === 0) return sorted
  const cutoff = pointTime(sorted[sorted.length - 1]) - windowMs
  return sorted.filter((p) => pointTime(p) >= cutoff)
}

export const createPatientStore = () =>
  createStore<PatientStoreState>()((set) => ({
    patients: {},

    // Adds new patients, refreshes names/targets, drops patients that are
    // no longer shared with this account. Other accounts' patients are kept.
    applyConnections: (connections, accountId) =>
      set((s) => {
        const patients: Record<string, PatientState> = {}
        for (const [id, p] of Object.entries(s.patients)) {
          if (p.accountId !== accountId) patients[id] = p
        }
        for (const c of connections) {
          const prev = s.patients[c.patientId]
          patients[c.patientId] = {
            ...prev,
            accountId,
            history: prev?.history ?? [],
            status: prev?.status ?? 'ok',
            patientId: c.patientId,
            name: displayName(c),
            targetLow: c.targetLow ?? prev?.targetLow,
            targetHigh: c.targetHigh ?? prev?.targetHigh,
          }
        }
        return { patients }
      }),

    applyGraph: (patientId, graph, now = Date.now()) =>
      set((s) => {
        const prev = s.patients[patientId]
        const latest = graph.glucoseMeasurement ?? graph.connection.glucoseMeasurement
        const incoming = latest ? [...graph.graphData, latest] : graph.graphData
        const history = mergeHistory(prev?.history ?? [], incoming)
        return {
          patients: {
            ...s.patients,
            [patientId]: {
              ...prev,
              patientId,
              name: displayName({ ...graph.connection, patientId }),
              targetLow: graph.connection.targetLow ?? prev?.targetLow,
              targetHigh: graph.connection.targetHigh ?? prev?.targetHigh,
              latest: latest ?? history[history.length - 1],
              history,
              status: 'ok',
              lastError: undefined,
              lastUpdated: now,
            },
          },
        }
      }),

    setError: (patientId, message) =>
      set((s) => {
        const prev = s.patients[patientId]
        if (!prev) return s
        return {
          patients: {
            ...s.patients,
            [patientId]: { ...prev, status: 'error', lastError: message },
          },
        }
      }),

    removeAccount: (accountId) =>
      set((s) => ({
        patients: Object.fromEntries(
          Object.entries(s.patients).filter(([, p]) => p.accountId !== accountId),
        ),
      })),

    clear: () => set({ patients: {} }),
  }))

export type PatientStore = ReturnType<typeof createPatientStore>
