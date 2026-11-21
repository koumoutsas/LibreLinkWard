import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose'

const MAX_RECORDS = 500
const MAX_BYTES = 4 * 1024 * 1024

type Sender = Pick<FirehoseClient, 'send'>

/**
 * Sends every record to the stream, one JSON object per Firehose record,
 * in batches within PutRecordBatch limits. Records Firehose rejects are
 * retried with backoff; throws if some are still rejected after `attempts`.
 */
export async function sendAll(
  client: Sender,
  stream: string,
  records: object[],
  { attempts = 5, baseDelayMs = 500 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<void> {
  let pending: Buffer[] = records.map((r) => Buffer.from(JSON.stringify(r)))
  for (let attempt = 1; pending.length; attempt++) {
    const failed: Buffer[] = []
    for (const batch of batches(pending)) {
      const res = await client.send(new PutRecordBatchCommand({ DeliveryStreamName: stream, Records: batch.map((Data) => ({ Data })) }))
      if (res.FailedPutCount) res.RequestResponses?.forEach((r, i) => r.ErrorCode && failed.push(batch[i]))
    }
    if (!failed.length) return
    if (attempt >= attempts) throw new Error(`${failed.length} record(s) were still rejected by ${stream} after ${attempts} attempts`)
    await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)))
    pending = failed
  }
}

function* batches(records: Buffer[]): Generator<Buffer[]> {
  let batch: Buffer[] = []
  let bytes = 0
  for (const r of records) {
    if (batch.length && (batch.length === MAX_RECORDS || bytes + r.length > MAX_BYTES)) {
      yield batch
      batch = []
      bytes = 0
    }
    batch.push(r)
    bytes += r.length
  }
  if (batch.length) yield batch
}
