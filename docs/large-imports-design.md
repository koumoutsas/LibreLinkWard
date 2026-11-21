# Design: imports of arbitrarily large files

**Status:** not implemented. This is a reference for when the current import pipeline starts hitting limits. Real Glooko exports are a few MB, well within what the current design handles.

## When to pick this up

Any of these signs means the current design has hit a limit:

- Imports fail with `… is larger than 67108864 bytes` (the per-entry cap in `infra/lib/imports/zip.ts`).
- `ImportFunction` runs out of memory (1024 MB) or times out (5 min).
- The CLI reports `No result after 3 minutes` for imports that do finish later.
- Firehose throttles `PutRecordBatch`, or backfills leave the Iceberg tables with many small files and equality deletes.

## How it works today, and where it breaks

An import is one Lambda invocation that holds everything in memory at once:

1. the whole zip (`transformToByteArray` in `infra/lambda/import.ts`),
2. every unzipped entry (`unzip()` returns them all),
3. each CSV decoded to a string (`parseCsv(text)`),
4. every parsed row (`ImportResult.readings` / `.events`),
5. every row again as a JSON Buffer (`sendAll` serializes all records before sending).

Rows go to Firehose, which upserts them into the Iceberg tables in S3 Tables. The CLI (`infra/scripts/import.ts`) also reads the whole file into memory, parses it locally, uploads it with a single `PutObject` (5 GB limit) and waits a fixed 3 minutes.

That leaves four limits to remove:

- **Memory:** the data is held about four times over.
- **Time:** one invocation, at most 15 minutes.
- **Firehose:** a throughput quota per stream, and an equality delete per upserted row. That suits trickle writes, not bulk loads.
- **CLI:** the whole file in memory, a single PUT, and a fixed wait.

## Stage 1: stream everything

Stage 1 should be enough up to a few GB per import. Memory stays proportional to one batch instead of the whole file.

1. **Zip via ranged reads** (`infra/lib/imports/zip.ts`). Read the end-of-central-directory record and the central directory with S3 range GETs (the ZIP64 parsing already exists). For each CSV entry, range-GET its bytes as a stream and pipe them through `zlib.createInflateRaw()`. Replace the fixed `MAX_ENTRY_BYTES` with a compression-ratio check and a total row cap as the zip-bomb guard.
2. **Streaming CSV** (`csv.ts`, `glooko.ts`). Turn `parseCsv(text)` into an async generator over byte chunks; it must carry quoted fields across chunk boundaries. Emit rows one at a time instead of building the `readings` and `events` arrays. Keep the summary as running counters: count, min and max of `t`, and kinds.
3. **Backpressure in sends** (`firehose.ts`). `sendAll` takes an async iterable and flushes each batch (500 records or 4 MB) as it fills, so only one batch is in memory at a time.
4. **Checkpoint and continue.** When the Lambda nears its timeout (`context.getRemainingTimeInMillis()`), write `progress/<importId>.json` with the entry index and the rows already sent, then re-invoke the function asynchronously. A deflate stream can't resume part-way, so the next run restarts that entry and skips the rows already sent. Upserts are idempotent, so replaying rows is harmless anyway. This removes the 15-minute limit for zips with many entries. A single huge entry still has to finish within one invocation.
5. **CLI** (`infra/scripts/import.ts`):
   - Hash the file as a stream for `importIdOf`.
   - Upload with `@aws-sdk/lib-storage` `Upload` (multipart, up to 5 TB).
   - Run the local `--check` as a stream, or on only the first N MB.
   - Poll `progress/` and `results/` with no fixed time limit.
6. **Stack** (`infra/lib/storage-stack.ts`):
   - Set the timeout to 15 minutes.
   - Allow the function `lambda:InvokeFunction` on itself.
   - Allow it to put objects under `progress/*`.

## Stage 2: bulk path for very large backfills

Use Stage 2 only if Stage 1 isn't enough. At that scale, the Firehose throughput and an equality delete per row are the bottlenecks. Instead:

1. The S3 event starts a **Step Functions** workflow instead of the Lambda.
2. A **Distributed Map** runs over the zip entries. Each worker (a Lambda, or a Fargate task for huge entries) streams one entry and writes normalized rows as Parquet or NDJSON to `staging/<importId>/<table>/part-N`. The Glooko mapping, the time zone handling and `IMPORTER_VERSION` stay in the same TypeScript code.
3. **Athena `MERGE INTO`** upserts each S3 Tables Iceberg table from a staging table, keyed on the same unique keys that Firehose uses. That is one transactional upsert, scaled out by Athena, with no per-stream quota. Afterwards, run Iceberg `OPTIMIZE` once and delete the staging data.
4. A final step writes `results/<importId>.json`, the same contract the CLI reads today.

A deflated entry can't be split without decompressing it from the start, so work runs in parallel per entry only. A single huge CSV goes to one Fargate task, which has no time limit.

## Verification

- **Unit tests** (`infra/test/zip.test.ts`, `infra/test/imports.test.ts`):
  - The existing fixtures give the same outputs as before.
  - A chunk boundary falls in the middle of a quoted CSV field.
  - A synthetic ZIP64 zip of several GB, generated as a stream.
- **Memory test:** run `importObject` on a generated 2 GB export locally with `--max-old-space-size=512`.
- **End to end:** deploy, then use the CLI to import a real Glooko export and a large synthetic one. Check that the row counts in Athena match the result summary, and that re-importing doesn't duplicate rows.
