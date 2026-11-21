import { parseCsv } from './csv'
import { checkZone, localToUtc } from './time'
import { unzip } from './zip'
import { IMPORT_ORIGIN } from '../schema'

/** Bumped when the parser changes in a way that affects rows; written to readings.app_version. */
export const IMPORTER_VERSION = 'importer-1'
export const MMOL_TO_MGDL = 18.0182

/** One `readings` row (docs/storage-schema.md), origin `import`. */
export type ImportedReading = {
  sid: string
  t: number
  origin: typeof IMPORT_ORIGIN
  mgdl: number
  trend: null
  install: string
  received_at: number
  app_version: string
  schema_version: 1
}

/** One `therapy_events` row (docs/storage-schema.md). */
export type TherapyEvent = {
  sid: string
  t: number
  kind: string
  subtype: string
  source: 'glooko'
  device: string | null
  units: number | null
  rate_uh: number | null
  duration_ms: number | null
  percent: number | null
  bg_mgdl: number | null
  carbs_g: number | null
  carb_ratio: number | null
  initial_units: number | null
  extended_units: number | null
  detail: string | null
  import_id: string
  imported_at: number
  schema_version: 1
}

export type ImportContext = {
  sid: string
  /** IANA zone the export's wall-clock timestamps are in. */
  tz: string
  /** Short content hash of the file; identifies the import. */
  importId: string
  importedAt: number
}

export type FileSummary = { name: string; table: 'readings' | 'therapy_events' | 'ignored'; rows: number }

export type ImportResult = {
  readings: ImportedReading[]
  events: TherapyEvent[]
  files: FileSummary[]
  /** Export's own "Date Range" line, when present. */
  dateRange?: string
  warnings: string[]
}

const SID = /^(linkup|nightscout):\S+$/
export const checkSid = (sid: string) => {
  if (!SID.test(sid)) throw new Error(`"${sid}" is not a patient id; expected linkup:<patientId> or nightscout:<host>`)
}

type Row = Record<string, string>
type Num = (header: string) => number | null

/** Event fields a file spec fills; the rest are filled in by `toEvent`. */
type EventFields = Partial<Omit<TherapyEvent, 'sid' | 't' | 'source' | 'import_id' | 'imported_at' | 'schema_version' | 'detail'>> & {
  kind: string
  detail?: Record<string, unknown>
}

/**
 * How to read one kind of Glooko CSV. `columns` must all be present (glucose
 * columns are matched by prefix, in mg/dl or mmol/l); any other column ends up
 * in `detail` so nothing in the export is silently dropped.
 */
type Spec = {
  columns: string[]
  map: (row: Row, num: Num, glucose: (prefix: string) => number | null) => EventFields | null
}

const lower = (s: string | undefined) => (s ?? '').trim()
const positive = (v: number | null) => (v !== null && v > 0 ? v : null)

const EVENT_SPECS: Record<string, Spec> = {
  bolus_data: {
    columns: ['Insulin Type', 'Blood Glucose Input', 'Carbs Input (g)', 'Carbs Ratio', 'Insulin Delivered (U)', 'Initial Delivery (U)', 'Extended Delivery (U)'],
    map: (r, num, glucose) => ({
      kind: 'bolus',
      subtype: lower(r['Insulin Type']),
      units: num('Insulin Delivered (U)'),
      // The PDM records 0 when no BG was entered.
      bg_mgdl: roundOrNull(positive(glucose('Blood Glucose Input'))),
      carbs_g: num('Carbs Input (g)'),
      carb_ratio: positive(num('Carbs Ratio')),
      initial_units: num('Initial Delivery (U)'),
      extended_units: num('Extended Delivery (U)'),
    }),
  },
  basal_data: {
    columns: ['Insulin Type', 'Duration (minutes)', 'Percentage (%)', 'Rate', 'Insulin Delivered (U)'],
    map: (r, num) => ({
      kind: 'basal',
      subtype: lower(r['Insulin Type']),
      rate_uh: num('Rate'),
      duration_ms: minutes(num('Duration (minutes)')),
      percent: num('Percentage (%)'),
      units: num('Insulin Delivered (U)'),
    }),
  },
  insulin_data: {
    columns: ['Total Bolus (U)', 'Total Insulin (U)', 'Total Basal (U)'],
    map: (_r, num) => ({
      kind: 'daily_total',
      units: num('Total Insulin (U)'),
      detail: { total_bolus_u: num('Total Bolus (U)'), total_basal_u: num('Total Basal (U)') },
    }),
  },
  bg_data: {
    columns: ['Glucose Value', 'Manual Reading'],
    map: (r, _num, glucose) => {
      const bg = roundOrNull(positive(glucose('Glucose Value')))
      return bg === null ? null : { kind: 'bg', bg_mgdl: bg, detail: { manual: lower(r['Manual Reading']) || null } }
    },
  },
  alarms_data: {
    columns: ['Alarm/Event'],
    map: (r) => ({ kind: 'alarm', subtype: lower(r['Alarm/Event']) }),
  },
  cgm_carbs_data: {
    columns: ['Carbs (g)'],
    map: (_r, num) => ({ kind: 'carbs', carbs_g: num('Carbs (g)') }),
  },
  food_data: {
    columns: ['Name', 'Carbs (g)', 'Fat', 'Protein', 'Calories', 'Serving Quantity', 'Number of Servings'],
    map: (r, num) => ({
      kind: 'food',
      subtype: lower(r.Name),
      carbs_g: num('Carbs (g)'),
      detail: {
        fat_g: num('Fat'),
        protein_g: num('Protein'),
        kcal: num('Calories'),
        serving_quantity: num('Serving Quantity'),
        servings: num('Number of Servings'),
      },
    }),
  },
  exercise_data: {
    columns: ['Name', 'Intensity', 'Duration (minutes)', 'Calories Burned'],
    map: (r, num) => ({
      kind: 'exercise',
      subtype: lower(r.Name),
      duration_ms: minutes(num('Duration (minutes)')),
      detail: { intensity: lower(r.Intensity) || null, kcal: num('Calories Burned') },
    }),
  },
  manual_insulin_data: {
    columns: ['Name', 'Value', 'Insulin Type'],
    map: (r, num) => ({ kind: 'manual_insulin', subtype: lower(r.Name), units: num('Value'), detail: { insulin_type: lower(r['Insulin Type']) || null } }),
  },
  medication_data: {
    columns: ['Name', 'Value', 'Medication Type'],
    map: (r) => ({ kind: 'medication', subtype: lower(r.Name), detail: { value: lower(r.Value) || null, medication_type: lower(r['Medication Type']) || null } }),
  },
  notes_data: {
    columns: ['Value'],
    map: (r) => ({ kind: 'note', detail: { text: r.Value ?? '' } }),
  },
}

const CGM_FILE = 'cgm_data'
const MAX_WARNINGS = 50

function roundOrNull(v: number | null): number | null {
  return v === null ? null : Math.round(v)
}
function minutes(v: number | null): number | null {
  return v === null ? null : Math.round(v * 60_000)
}

/** `Insulin data/bolus_data_2.csv` -> `bolus_data`. */
const fileKind = (path: string) => path.split('/').pop()!.replace(/_\d+\.csv$/i, '').replace(/\.csv$/i, '').toLowerCase()

/** Finds the glucose column starting with `prefix` and its unit. */
function glucoseColumn(header: string[], prefix: string): { name: string; factor: number } | undefined {
  const name = header.find((h) => h.startsWith(prefix))
  if (!name) return undefined
  const unit = /\((mg\/dl|mmol\/l)\)/i.exec(name)?.[1]?.toLowerCase()
  if (!unit) throw new Error(`Cannot tell the glucose unit of column "${name}"`)
  return { name, factor: unit === 'mmol/l' ? MMOL_TO_MGDL : 1 }
}

/**
 * Parses a Glooko "Export to CSV" zip into `readings` rows (from cgm_data,
 * origin `import`) and `therapy_events` rows (everything else). Throws on a
 * file whose header is not recognised; unknown files are skipped with a warning.
 * Rows never carry the patient name from the export's first line.
 */
export function parseGlookoZip(zip: Uint8Array, ctx: ImportContext): ImportResult {
  checkSid(ctx.sid)
  checkZone(ctx.tz)
  const entries = unzip(zip)
  const files = Object.keys(entries)
    .filter((p) => /\.csv$/i.test(p) && !p.split('/').some((s) => s.startsWith('__MACOSX') || s.startsWith('.')))
    .sort()
  if (!files.some((p) => fileKind(p) === CGM_FILE || fileKind(p) in EVENT_SPECS)) {
    throw new Error('This zip has no Glooko CSV files (expected cgm_data_1.csv, Insulin data/bolus_data_1.csv, ...)')
  }

  const result: ImportResult = { readings: [], events: [], files: [], warnings: [] }
  const warn = (msg: string) => {
    if (result.warnings.length < MAX_WARNINGS) result.warnings.push(msg)
    else if (result.warnings.length === MAX_WARNINGS) result.warnings.push('(more warnings omitted)')
  }
  const install = `import:${ctx.importId}`
  const seen = new Map<string, number>()

  for (const path of files) {
    const kind = fileKind(path)
    const spec = EVENT_SPECS[kind]
    if (kind !== CGM_FILE && !spec) {
      warn(`${path}: unknown file, skipped`)
      result.files.push({ name: path, table: 'ignored', rows: 0 })
      continue
    }
    let rows = parseCsv(new TextDecoder().decode(entries[path]))
    // First line: "Name:<patient>,Date Range:<from> - <to>". Keep the range, never the name.
    if (rows[0]?.[0]?.startsWith('Name:')) {
      const range = rows[0].find((f) => f.startsWith('Date Range:'))
      if (range && !result.dateRange) result.dateRange = range.slice('Date Range:'.length).trim()
      rows = rows.slice(1)
    }
    const header = (rows.shift() ?? []).map((h) => h.trim())
    if (header[0] !== 'Timestamp') throw new Error(`${path}: expected a Timestamp column first, got "${header[0] ?? ''}"`)

    const time = (r: Row, line: number): number | null => {
      try {
        const lt = localToUtc(r.Timestamp, ctx.tz)
        if (lt.ambiguous) warn(`${path} line ${line}: ${r.Timestamp} happened twice (clocks went back); used the earlier one`)
        if (lt.skipped) warn(`${path} line ${line}: ${r.Timestamp} does not exist in ${ctx.tz} (clocks went forward)`)
        return lt.t
      } catch (e) {
        warn(`${path} line ${line}: ${e instanceof Error ? e.message : e}; row skipped`)
        return null
      }
    }
    const toRow = (cells: string[]): Row => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]))
    const numberOf = (r: Row, line: number): Num => (h) => {
      const v = r[h]
      if (v === undefined || v === '') return null
      const n = Number(v)
      if (!Number.isFinite(n)) {
        warn(`${path} line ${line}: "${v}" in ${h} is not a number`)
        return null
      }
      return n
    }

    if (kind === CGM_FILE) {
      const col = glucoseColumn(header, 'CGM Glucose Value')
      if (!col) throw new Error(`${path}: no "CGM Glucose Value" column`)
      let count = 0
      rows.forEach((cells, i) => {
        const line = i + 3
        const r = toRow(cells)
        const t = time(r, line)
        const v = numberOf(r, line)(col.name)
        if (t === null) return
        if (v === null || v <= 0) {
          warn(`${path} line ${line}: no glucose value; row skipped`)
          return
        }
        result.readings.push({
          sid: ctx.sid,
          t,
          origin: IMPORT_ORIGIN,
          mgdl: Math.round(v * col.factor),
          trend: null,
          install,
          received_at: ctx.importedAt,
          app_version: IMPORTER_VERSION,
          schema_version: 1,
        })
        count++
      })
      result.files.push({ name: path, table: 'readings', rows: count })
      continue
    }

    const glucoseCols = new Map<string, { name: string; factor: number }>()
    for (const c of spec.columns) {
      const isGlucose = c === 'Glucose Value' || c === 'Blood Glucose Input'
      const found = isGlucose ? glucoseColumn(header, c) : header.includes(c) ? { name: c, factor: 1 } : undefined
      if (!found) throw new Error(`${path}: missing column "${c}"; columns are ${header.join(', ')}`)
      if (isGlucose) glucoseCols.set(c, found)
    }
    const known = new Set(['Timestamp', 'Serial Number', ...spec.columns, ...[...glucoseCols.values()].map((g) => g.name)])
    const extra = header.filter((h) => !known.has(h))

    let count = 0
    rows.forEach((cells, i) => {
      const line = i + 3
      const r = toRow(cells)
      const t = time(r, line)
      if (t === null) return
      const num = numberOf(r, line)
      const glucose = (prefix: string) => {
        const g = glucoseCols.get(prefix)!
        const v = num(g.name)
        return v === null ? null : v * g.factor
      }
      const fields = spec.map(r, num, glucose)
      if (!fields) return
      const detail = { ...(fields.detail ?? {}) }
      for (const h of extra) if (r[h] !== '') detail[h] = r[h]
      const base = fields.subtype ?? ''
      // Identical (t, kind, subtype) twice in one export: keep both, deterministically.
      const key = `${t}|${fields.kind}|${base}`
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      result.events.push({
        sid: ctx.sid,
        t,
        kind: fields.kind,
        subtype: n === 1 ? base : `${base}#${n}`,
        source: 'glooko',
        device: r['Serial Number'] || null,
        units: fields.units ?? null,
        rate_uh: fields.rate_uh ?? null,
        duration_ms: fields.duration_ms ?? null,
        percent: fields.percent ?? null,
        bg_mgdl: fields.bg_mgdl ?? null,
        carbs_g: fields.carbs_g ?? null,
        carb_ratio: fields.carb_ratio ?? null,
        initial_units: fields.initial_units ?? null,
        extended_units: fields.extended_units ?? null,
        detail: Object.values(detail).some((v) => v !== null && v !== undefined) ? JSON.stringify(detail) : null,
        import_id: ctx.importId,
        imported_at: ctx.importedAt,
        schema_version: 1,
      })
      count++
    })
    result.files.push({ name: path, table: 'therapy_events', rows: count })
  }
  return result
}

/** Short summary for the CLI and the import result file. */
export function summarize(res: ImportResult) {
  const span = (ts: number[]) =>
    ts.length ? { from: new Date(Math.min(...ts)).toISOString(), to: new Date(Math.max(...ts)).toISOString() } : null
  const byKind: Record<string, number> = {}
  for (const e of res.events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
  return {
    dateRange: res.dateRange ?? null,
    readings: { count: res.readings.length, span: span(res.readings.map((r) => r.t)) },
    events: { count: res.events.length, byKind, span: span(res.events.map((e) => e.t)) },
    files: res.files,
    warnings: res.warnings,
  }
}
