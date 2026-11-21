import {
  DescribeDeliveryStreamCommand,
  FirehoseClient,
  PutRecordBatchCommand,
} from '@aws-sdk/client-firehose'
import type { RecordingTarget } from './blob'

/** One row of the `readings` table; see docs/storage-schema.md. */
export type ReadingRecord = {
  sid: string
  t: number
  origin: 'latest' | 'graph'
  mgdl: number
  trend: number | null
  install: string
  received_at: number
  app_version: string
  schema_version: 1
}

/** Firehose's PutRecordBatch limits. */
export const MAX_BATCH_RECORDS = 500
const MAX_BATCH_BYTES = 4 * 1024 * 1024

/** A key or stream problem that retrying will not fix (revoked key, deleted stream). */
export class RecordingAuthError extends Error {}

const FATAL = new Set([
  'AccessDeniedException',
  'UnrecognizedClientException',
  'InvalidSignatureException',
  'ResourceNotFoundException',
  'InvalidClientTokenId',
])

const asError = (e: unknown): Error => {
  const name = (e as { name?: string })?.name ?? ''
  const message = e instanceof Error ? e.message : String(e)
  return FATAL.has(name) ? new RecordingAuthError(`${name}: ${message}`) : e instanceof Error ? e : new Error(message)
}

/** The two Firehose calls the recorder uses; injectable for tests. */
export interface Publisher {
  /** Sends the records; returns the ones Firehose did not accept (to retry later). */
  send(records: ReadingRecord[]): Promise<ReadingRecord[]>
  /** Checks key, region and stream; throws when the stream cannot be written. */
  test(): Promise<void>
}

type Sender = Pick<FirehoseClient, 'send'>

export class FirehosePublisher implements Publisher {
  private readonly client: Sender

  constructor(
    private readonly target: RecordingTarget,
    client?: Sender,
  ) {
    this.client =
      client ??
      new FirehoseClient({
        region: target.region,
        credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey },
      })
  }

  async send(records: ReadingRecord[]): Promise<ReadingRecord[]> {
    const failed: ReadingRecord[] = []
    for (const batch of batches(records)) {
      let res
      try {
        res = await this.client.send(
          new PutRecordBatchCommand({
            DeliveryStreamName: this.target.stream,
            // One JSON object per record: Firehose maps its top-level fields to columns.
            Records: batch.map((r) => ({ Data: Buffer.from(JSON.stringify(r)) })),
          }),
        )
      } catch (e) {
        throw asError(e)
      }
      if (res.FailedPutCount) {
        res.RequestResponses?.forEach((r, i) => {
          if (r.ErrorCode) failed.push(batch[i])
        })
      }
    }
    return failed
  }

  async test(): Promise<void> {
    let res
    try {
      res = await this.client.send(
        new DescribeDeliveryStreamCommand({ DeliveryStreamName: this.target.stream }),
      )
    } catch (e) {
      throw asError(e)
    }
    const status = res.DeliveryStreamDescription?.DeliveryStreamStatus
    if (status !== 'ACTIVE') throw new Error(`The stream is ${status ?? 'unavailable'}, not ACTIVE`)
  }
}

function* batches(records: ReadingRecord[]): Generator<ReadingRecord[]> {
  let batch: ReadingRecord[] = []
  let bytes = 0
  for (const r of records) {
    const size = JSON.stringify(r).length
    if (batch.length === MAX_BATCH_RECORDS || bytes + size > MAX_BATCH_BYTES) {
      yield batch
      batch = []
      bytes = 0
    }
    batch.push(r)
    bytes += size
  }
  if (batch.length) yield batch
}
