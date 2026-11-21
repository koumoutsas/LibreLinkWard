# Storage schema (the `readings` table)

This is the contract between LibreLinkWard clients and anything that analyses the recorded data. The storage stack (`infra/`) creates the tables. Clients and the backfill importer write to them. Analytics flows (ours or yours) only depend on what is described here.

There are two tables:
- **`readings`** holds glucose: live client recordings, plus backfill from exports.
- **`therapy_events`** holds insulin pump and logbook data imported from exports. See [the therapy_events table](#the-therapy_events-table).

## Location

- An Apache Iceberg table (format version 2) in Amazon S3 Tables.
- Table bucket `librelinkward`, namespace `librelinkward`, table `readings`.
- In the AWS Glue Data Catalog (and Athena) it appears as `"s3tablescatalog/librelinkward"."librelinkward"."readings"`.
- Any engine that reads Iceberg with equality deletes can read it: Athena, Spark/EMR/Glue, Trino, Redshift, DuckDB, PyIceberg.

## Columns

| id | column | type | required | meaning |
|---|---|---|---|---|
| 1 | `sid` | string | yes | The patient: `linkup:<LibreLinkUp patientId>` or `nightscout:<lower-case host[:port][/path]>`. One person is one sid. |
| 2 | `t` | long | yes | Time of the sensor reading in epoch milliseconds, UTC. For LibreLinkUp this is the sensor's FactoryTimestamp. For Nightscout it is the entry `date`. |
| 3 | `origin` | string | yes | `latest`, `graph` or `import`. `latest` is the current reading a client saw when it polled, usually one per minute while a client runs. `graph` is a point from the source's 12 h history, which is sparser for LibreLinkUp. Graph points fill the gaps when no client was polling. `import` is a point backfilled from an export (for example LibreView data via Glooko, every 15 minutes) and fills the gaps that no client covered at all. |
| 4 | `mgdl` | int | yes | Glucose in mg/dL. |
| 5 | `trend` | int | no | Trend arrow from 1 to 5 on the LibreLinkUp scale: 1 falling fast, 3 flat, 5 rising fast. Null when unknown, which is typical for `graph` points. |
| 6 | `install` | string | yes | Name of the install (computer) that wrote the row, as issued by the deployment. For `import` rows it is `import:<import id>`, the import that wrote the row. |
| 7 | `received_at` | long | yes | Epoch ms when that install recorded the reading. |
| 8 | `app_version` | string | yes | LibreLinkWard version of that install, or the importer version (`importer-1`) for `import` rows. |
| 9 | `schema_version` | int | yes | `1`. |

- **Partitioning:** identity on `sid`.
- **Identifier fields:** `(sid, t, origin)`.

## Guarantees

- **One row per `(sid, t, origin)`.** Several installs may record the same patient. Every record is delivered as an Iceberg upsert on these keys, so identical readings from different installs fold into one row. `install` and `received_at` are those of whichever copy was written last.
- **`latest` before `graph` before `import`.** Rows with different origins can share the same `(sid, t)`. Prefer `latest`, because only `latest` rows carry a trend.
  - **Import times are minute-aligned.** Exports give times to the minute in local time. The importer converts them to UTC with the time zone given at import. An `import` row therefore sits up to a minute away from the matching client row and does not share its `t`. When combining origins, prefer client rows wherever any exist nearby, as in the example below.
- **Resolution varies.**
  - **Dense periods:** while any install is recording, there is roughly one `latest` row per minute.
  - **Sparse periods:** periods covered only by `graph` rows are sparser. Resample or weight them accordingly.
- **Imports are idempotent.** Importing the same or an overlapping export again upserts the same rows.
- **Recording is opt-in, per patient and per install.**
  - **Gaps are expected:** a period with no rows means no install was recording, not that the glucose was unknown.
  - **Turning on:** when recording is turned on, nothing from before that moment is sent.
- **No ordering.** Rows arrive within about five minutes (Firehose buffering), in no particular order.
- **Values in the table are not editable.** To remove a bad import, use `DELETE FROM … WHERE install = 'import:<id>'`, then import the corrected export.

## Evolution

- **Allowed changes:** only additive ones, as new optional columns with new field ids, or new values of `origin` and `kind`. Readers should filter on the values they know rather than assume the set is closed. `import` was added this way.
- **Never changed:** existing columns are never renamed, retyped or given a new meaning.
- **Breaking changes:** a change that cannot be made additively gets a new table and a new `schema_version`.

## Example (Athena)

```sql
-- One value per patient and minute, preferring the live reading
SELECT sid, from_unixtime(t / 1000) AS time_utc, mgdl, trend
FROM (
  SELECT *, row_number() OVER (PARTITION BY sid, t ORDER BY origin = 'latest' DESC) AS rn
  FROM "s3tablescatalog/librelinkward"."librelinkward"."readings"
  WHERE origin <> 'import'
)
WHERE rn = 1
ORDER BY sid, t;
```

```sql
-- Client data, plus imported points only where no client row exists within 10 minutes
WITH r AS (SELECT * FROM "s3tablescatalog/librelinkward"."librelinkward"."readings")
SELECT sid, t, mgdl, origin FROM r WHERE origin <> 'import'
UNION ALL
SELECT i.sid, i.t, i.mgdl, i.origin FROM r i
WHERE i.origin = 'import'
  AND NOT EXISTS (
    SELECT 1 FROM r c
    WHERE c.sid = i.sid AND c.origin <> 'import' AND abs(c.t - i.t) < 600000
  )
ORDER BY sid, t;
```

## The `therapy_events` table

Insulin pump and logbook events, imported from exports. It sits in the same table bucket and namespace as `readings`. In Athena it is `"s3tablescatalog/librelinkward"."librelinkward"."therapy_events"`. It has the same Iceberg format, partitioning and evolution rules.

| id | column | type | required | meaning |
|---|---|---|---|---|
| 1 | `sid` | string | yes | The patient, with the same ids as `readings.sid`, so the two tables join on `sid`. |
| 2 | `t` | long | yes | Epoch ms, UTC, when the event started. Converted from the export's local wall time with the time zone given at import. |
| 3 | `kind` | string | yes | See the kinds below. |
| 4 | `subtype` | string | yes | A kind-specific label, or empty. If the same `(t, kind, subtype)` appears twice in one export, the second copy gets `#2`, and so on. |
| 5 | `source` | string | yes | The export format, for example `glooko`. |
| 6 | `device` | string | no | The device serial number from the export. |
| 7 | `units` | double | no | Insulin in units (U). |
| 8 | `rate_uh` | double | no | Basal rate in U/h. |
| 9 | `duration_ms` | long | no | Duration of a basal segment, suspend or exercise. |
| 10 | `percent` | double | no | Temporary basal percentage. |
| 11 | `bg_mgdl` | int | no | Blood glucose in mg/dL; mmol/L is converted. |
| 12 | `carbs_g` | double | no | Carbohydrates in grams. |
| 13 | `carb_ratio` | double | no | Insulin-to-carb ratio (g/U) the bolus used. |
| 14 | `initial_units` | double | no | Immediate part of an extended bolus. |
| 15 | `extended_units` | double | no | Extended part of an extended bolus. |
| 16 | `detail` | string | no | A JSON object with the row's remaining fields. Columns the importer does not know are also kept here, so nothing in an export is dropped. |
| 17 | `import_id` | string | yes | The import that wrote the row. |
| 18 | `imported_at` | long | yes | Epoch ms of that import. |
| 19 | `schema_version` | int | yes | `1`. |

- **Identifier fields:** `(sid, t, kind, subtype)`. Re-importing upserts, so an overlapping export replaces the earlier rows instead of duplicating them.

### Kinds (Glooko export)

| kind | from | fields |
|---|---|---|
| `bolus` | `bolus_data` | `subtype` is the insulin type (`Normal`, `Extended`). Also `units` delivered, `bg_mgdl` and `carbs_g` as entered, `carb_ratio`, `initial_units` and `extended_units`. A BG of 0 or an empty ratio means "not entered" and is stored as null. |
| `basal` | `basal_data` | `subtype` is `Scheduled`, `Suspend` or `Temp`. Also `rate_uh`, `duration_ms`, `percent` and `units`. A suspend has rate 0. Scheduled segments are split at midnight and around suspends. |
| `daily_total` | `insulin_data` | `units` is the day's total insulin, with `total_bolus_u` and `total_basal_u` in `detail`. `t` is local midnight. |
| `bg` | `bg_data` | Meter or manual readings, in `bg_mgdl`. |
| `alarm` | `alarms_data` | `subtype` is the alarm or event name, for example `Insulet Exp1` (pod expiry). |
| `carbs` | `cgm_carbs_data` | `carbs_g`. |
| `food` | `food_data` | `subtype` is the food name, with `carbs_g`. Fat, protein, calories and servings go in `detail`. |
| `exercise` | `exercise_data` | `subtype` is the name, with `duration_ms`. Intensity and calories go in `detail`. |
| `manual_insulin` | `manual_insulin_data` | `subtype` is the name, with `units`. The insulin type goes in `detail`. |
| `medication` | `medication_data` | `subtype` is the name. The value and medication type go in `detail`. |
| `note` | `notes_data` | `detail.text`. |

```sql
-- Boluses with the glucose 2 hours later
SELECT b.sid, from_unixtime(b.t / 1000) AS bolus_utc, b.units, b.carbs_g, b.bg_mgdl AS bg_before,
       (SELECT avg(r.mgdl) FROM "s3tablescatalog/librelinkward"."librelinkward"."readings" r
        WHERE r.sid = b.sid AND r.t BETWEEN b.t + 6900000 AND b.t + 7500000) AS mgdl_after_2h
FROM "s3tablescatalog/librelinkward"."librelinkward"."therapy_events" b
WHERE b.kind = 'bolus'
ORDER BY b.sid, b.t;
```
