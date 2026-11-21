# Storage schema (the `readings` table)

This is the contract between LibreLinkWard clients and anything that analyses the recorded data. The storage stack (`infra/`) creates the table and the clients write to it. Analytics flows (ours or yours) only depend on what is described here.

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
| 3 | `origin` | string | yes | Either `latest` or `graph`. `latest` is the current reading a client saw when it polled, usually one per minute while a client runs. `graph` is a point from the source's 12 h history, which is sparser for LibreLinkUp. Graph points fill the gaps when no client was polling. |
| 4 | `mgdl` | int | yes | Glucose in mg/dL. |
| 5 | `trend` | int | no | Trend arrow from 1 to 5 on the LibreLinkUp scale: 1 falling fast, 3 flat, 5 rising fast. Null when unknown, which is typical for `graph` points. |
| 6 | `install` | string | yes | Name of the install (computer) that wrote the row, as issued by the deployment. |
| 7 | `received_at` | long | yes | Epoch ms when that install recorded the reading. |
| 8 | `app_version` | string | yes | LibreLinkWard version of that install. |
| 9 | `schema_version` | int | yes | `1`. |

- **Partitioning:** identity on `sid`.
- **Identifier fields:** `(sid, t, origin)`.

## Guarantees

- **One row per `(sid, t, origin)`.** Several installs may record the same patient. Every record is delivered as an Iceberg upsert on these keys, so identical readings from different installs fold into one row. `install` and `received_at` are those of whichever copy was written last.
- **`latest` before `graph`.** A `latest` row and a `graph` row can share the same `(sid, t)`. Prefer `latest`, because only `latest` rows carry a trend.
- **Resolution varies.**
  - **Dense periods:** while any install is recording, there is roughly one `latest` row per minute.
  - **Sparse periods:** periods covered only by `graph` rows are sparser. Resample or weight them accordingly.
- **Recording is opt-in, per patient and per install.**
  - **Gaps are expected:** a period with no rows means no install was recording, not that the glucose was unknown.
  - **Turning on:** when recording is turned on, nothing from before that moment is sent.
- **No ordering.** Rows arrive within about five minutes (Firehose buffering), in no particular order.

## Evolution

- **Allowed changes:** only additive ones, as new optional columns with new field ids.
- **Never changed:** existing columns are never renamed, retyped or given a new meaning.
- **Breaking changes:** a change that cannot be made additively gets a new table and a new `schema_version`.

## Example (Athena)

```sql
-- One value per patient and minute, preferring the live reading
SELECT sid, from_unixtime(t / 1000) AS time_utc, mgdl, trend
FROM (
  SELECT *, row_number() OVER (PARTITION BY sid, t ORDER BY origin = 'latest' DESC) AS rn
  FROM "s3tablescatalog/librelinkward"."librelinkward"."readings"
)
WHERE rn = 1
ORDER BY sid, t;
```
