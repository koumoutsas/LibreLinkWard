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
