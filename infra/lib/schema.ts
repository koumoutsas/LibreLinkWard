/**
 * The `readings` table: the public contract between LibreLinkWard clients and
 * any analytics. Documented in docs/storage-schema.md. Changes are additive
 * only (new optional fields with new ids); never reuse or retype an id.
 */
export const NAMESPACE = 'librelinkward'
export const TABLE = 'readings'

export const FIELDS = [
  { id: 1, name: 'sid', type: 'string', required: true, doc: 'linkup:<patientId> or nightscout:<host[/path]>' },
  { id: 2, name: 't', type: 'long', required: true, doc: 'Epoch ms (UTC) of the sensor reading' },
  { id: 3, name: 'origin', type: 'string', required: true, doc: 'latest (current reading of a poll) or graph (history/back-fill)' },
  { id: 4, name: 'mgdl', type: 'int', required: true, doc: 'Glucose in mg/dL' },
  { id: 5, name: 'trend', type: 'int', required: false, doc: 'Trend arrow 1-5 (LibreLinkUp scale), null when unknown' },
  { id: 6, name: 'install', type: 'string', required: true, doc: 'Name of the install that wrote the row' },
  { id: 7, name: 'received_at', type: 'long', required: true, doc: 'Epoch ms when the client recorded the reading' },
  { id: 8, name: 'app_version', type: 'string', required: true, doc: 'Client version' },
  { id: 9, name: 'schema_version', type: 'int', required: true, doc: 'Record schema version (1)' },
] as const

/** A row is unique per (sid, t, origin); Firehose upserts on these. */
export const UNIQUE_KEYS = ['sid', 't', 'origin']

/** `origin` of readings backfilled from an export (see docs/storage-schema.md). */
export const IMPORT_ORIGIN = 'import'

/**
 * The `therapy_events` table: pump and logbook events (boluses, basal
 * segments, suspends, alarms, finger-stick BG, carbs, food...) imported from
 * exports. Same evolution rules as `readings`.
 */
export const EVENTS_TABLE = 'therapy_events'

export const EVENT_FIELDS = [
  { id: 1, name: 'sid', type: 'string', required: true, doc: 'Patient, same ids as readings.sid' },
  { id: 2, name: 't', type: 'long', required: true, doc: 'Epoch ms (UTC) the event started' },
  { id: 3, name: 'kind', type: 'string', required: true, doc: 'bolus, basal, daily_total, bg, alarm, carbs, food, exercise, manual_insulin, medication, note' },
  { id: 4, name: 'subtype', type: 'string', required: true, doc: 'Kind-specific label (insulin type, alarm name, food name), empty when none' },
  { id: 5, name: 'source', type: 'string', required: true, doc: 'Export format the row came from, e.g. glooko' },
  { id: 6, name: 'device', type: 'string', required: false, doc: 'Device serial number from the export' },
  { id: 7, name: 'units', type: 'double', required: false, doc: 'Insulin delivered (U)' },
  { id: 8, name: 'rate_uh', type: 'double', required: false, doc: 'Basal rate (U/h)' },
  { id: 9, name: 'duration_ms', type: 'long', required: false, doc: 'Duration of a basal segment, suspend or exercise' },
  { id: 10, name: 'percent', type: 'double', required: false, doc: 'Temp basal percentage' },
  { id: 11, name: 'bg_mgdl', type: 'int', required: false, doc: 'Blood glucose in mg/dL (finger stick or bolus input)' },
  { id: 12, name: 'carbs_g', type: 'double', required: false, doc: 'Carbohydrates (g)' },
  { id: 13, name: 'carb_ratio', type: 'double', required: false, doc: 'Insulin-to-carb ratio (g/U) used by the bolus' },
  { id: 14, name: 'initial_units', type: 'double', required: false, doc: 'Immediate part of an extended bolus (U)' },
  { id: 15, name: 'extended_units', type: 'double', required: false, doc: 'Extended part of an extended bolus (U)' },
  { id: 16, name: 'detail', type: 'string', required: false, doc: 'JSON object with the remaining fields of the source row' },
  { id: 17, name: 'import_id', type: 'string', required: true, doc: 'Import that wrote the row (sha256 prefix of the file)' },
  { id: 18, name: 'imported_at', type: 'long', required: true, doc: 'Epoch ms of the import' },
  { id: 19, name: 'schema_version', type: 'int', required: true, doc: 'Record schema version (1)' },
] as const

/** A row is unique per (sid, t, kind, subtype); imports upsert on these. */
export const EVENT_UNIQUE_KEYS = ['sid', 't', 'kind', 'subtype']
