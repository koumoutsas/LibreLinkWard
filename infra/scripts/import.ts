#!/usr/bin/env -S npx ts-node
/**
 * Backfill CLI. Uses your normal AWS credentials (they need s3:PutObject,
 * s3:GetObject and s3:ListBucket on the imports bucket) and the stack's
 * Region from AWS_REGION.
 *
 *   npx ts-node scripts/import.ts glooko <sid> <export.zip> --tz <IANA zone> [--check]
 *   npx ts-node scripts/import.ts list
 *
 * The file is parsed locally first, so a bad export fails before anything is
 * uploaded; --check stops there. Uploading the same file again re-imports it
 * (rows are upserted, nothing is duplicated).
 */
import fs from 'fs'
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation'
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { parseGlookoZip, summarize } from '../lib/imports/glooko'
import { importIdOf, rawKey, resultKey } from '../lib/imports/keys'

const STACK = 'LibreLinkWardStorage'
const WAIT_MS = 3 * 60_000

async function bucketName(region: string): Promise<string> {
  const res = await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: STACK }))
  const name = res.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === 'ImportsBucketName')?.OutputValue
  if (!name) throw new Error(`Stack ${STACK} in ${region} has no ImportsBucketName output; deploy the stack first`)
  return name
}

async function readResult(s3: S3Client, bucket: string, importId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: resultKey(importId) }))
    return JSON.parse(await obj.Body!.transformToString())
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchKey') return undefined
    throw e
  }
}

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function printSummary(s: ReturnType<typeof summarize>) {
  console.log(`Export range: ${s.dateRange ?? 'unknown'}`)
  const span = (x: { from: string; to: string } | null) => (x ? `${x.from} .. ${x.to}` : '-')
  console.log(`readings:       ${s.readings.count} (${span(s.readings.span)})`)
  console.log(`therapy_events: ${s.events.count} (${span(s.events.span)})`)
  for (const [k, n] of Object.entries(s.events.byKind)) console.log(`  ${k}: ${n}`)
  for (const w of s.warnings) console.log(`warning: ${w}`)
}

async function importGlooko(region: string | undefined, sid: string, file: string, tz: string, check: boolean) {
  const bytes = fs.readFileSync(file)
  const importId = importIdOf(bytes)
  const parsed = parseGlookoZip(bytes, { sid, tz, importId, importedAt: Date.now() })
  printSummary(summarize(parsed))
  if (check) return
  if (!region) throw new Error('Set AWS_REGION to the Region the stack is deployed in')

  const s3 = new S3Client({ region })
  const bucket = await bucketName(region)
  const startedAt = Date.now()
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: rawKey('glooko', importId), Body: bytes, ContentType: 'application/zip', Metadata: { sid, tz } }),
  )
  console.log(`Uploaded as import ${importId}; waiting for it to be processed...`)
  while (Date.now() - startedAt < WAIT_MS) {
    await new Promise((r) => setTimeout(r, 3000))
    const result = await readResult(s3, bucket, importId)
    if (!result || Date.parse(String(result.importedAt)) < startedAt - 5000) continue
    if (result.status !== 'ok') throw new Error(`Import failed: ${result.error}`)
    console.log(`Done. Rows appear in the tables within about 5 minutes (Firehose buffering).`)
    return
  }
  throw new Error(`No result after ${WAIT_MS / 60000} minutes; check the ImportFunction logs, or run "list" later`)
}

async function list(region: string) {
  const s3 = new S3Client({ region })
  const bucket = await bucketName(region)
  const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'results/' }))
  const ids = (res.Contents ?? []).map((o) => o.Key!.replace(/^results\/|\.json$/g, ''))
  if (!ids.length) console.log('No imports yet.')
  for (const id of ids) {
    type Result = { status: string; importedAt: string; sid?: string; error?: string; dateRange?: string; readings: { count: number }; events: { count: number } }
    const r = (await readResult(s3, bucket, id)) as Result
    const counts = r.status === 'ok' ? `${r.readings.count} readings, ${r.events.count} events, ${r.dateRange ?? ''}` : `error: ${r.error}`
    console.log(`${id}\t${r.importedAt}\t${r.sid ?? ''}\t${counts}`)
  }
}

async function main() {
  const region = process.env.AWS_REGION
  const args = process.argv.slice(2)
  const [cmd, sid, file] = args
  if (cmd === 'glooko' && sid && file && flag(args, '--tz')) {
    await importGlooko(region, sid, file, flag(args, '--tz')!, args.includes('--check'))
  } else if (cmd === 'list') {
    if (!region) throw new Error('Set AWS_REGION to the Region the stack is deployed in')
    await list(region)
  } else {
    console.error('usage: import.ts glooko <sid> <export.zip> --tz <IANA zone> [--check] | list')
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
