#!/usr/bin/env -S npx ts-node
/**
 * Admin CLI for the pairs API. Uses your normal AWS credentials (they need
 * execute-api:Invoke on the API) and the stack's Region from AWS_REGION.
 *
 *   npx ts-node scripts/pairs.ts list
 *   npx ts-node scripts/pairs.ts create <install> <sid> [--print]
 *   npx ts-node scripts/pairs.ts revoke <install> <sid>
 *
 * `create` copies the config to the clipboard (macOS pbcopy) unless --print is given.
 */
import { execFileSync } from 'child_process'
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { Sha256 } from '@aws-crypto/sha256-js'
import { HttpRequest } from '@smithy/protocol-http'
import { SignatureV4 } from '@smithy/signature-v4'

const STACK = 'LibreLinkWardStorage'

async function apiUrl(region: string): Promise<string> {
  const res = await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: STACK }))
  const url = res.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === 'PairsApiUrl')?.OutputValue
  if (!url) throw new Error(`Stack ${STACK} in ${region} has no PairsApiUrl output; deploy the stack first`)
  return url
}

async function call(region: string, method: string, query: Record<string, string> = {}, body?: unknown) {
  const url = new URL('/pairs', await apiUrl(region))
  const request = new HttpRequest({
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    query,
    headers: { host: url.hostname, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const signer = new SignatureV4({ service: 'execute-api', region, credentials: fromNodeProviderChain(), sha256: Sha256 })
  const signed = await signer.sign(request)
  const qs = new URLSearchParams(query).toString()
  const res = await fetch(`${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`, {
    method,
    headers: signed.headers as Record<string, string>,
    body: signed.body as string | undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${res.status}: ${(data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? res.statusText}`)
  return data as Record<string, unknown>
}

async function main() {
  const region = process.env.AWS_REGION
  if (!region) throw new Error('Set AWS_REGION to the Region the stack is deployed in')
  const [cmd, install, sid, flag] = process.argv.slice(2)
  if (cmd === 'list') {
    const { pairs } = (await call(region, 'GET')) as { pairs: Array<Record<string, unknown>> }
    if (!pairs.length) console.log('No pairs issued through the API.')
    for (const p of pairs) console.log(`${p.install}\t${p.sid}\t${p.createdAt}\t${p.createdBy}`)
  } else if (cmd === 'create' && install && sid) {
    const res = await call(region, 'POST', {}, { install, sid })
    if (flag === '--print') {
      console.log(res.blob)
    } else {
      execFileSync('pbcopy', { input: String(res.blob) })
      console.log(`Created ${install} / ${sid}. The config is on the clipboard; paste it into that patient's Data recording card on ${install}.`)
    }
    console.log('A new key can take up to a minute to work; press Test connection again if the first test fails.')
  } else if (cmd === 'revoke' && install && sid) {
    await call(region, 'DELETE', { install, sid })
    console.log(`Revoked ${install} / ${sid}.`)
  } else {
    console.error('usage: pairs.ts list | create <install> <sid> [--print] | revoke <install> <sid>')
    process.exit(2)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
