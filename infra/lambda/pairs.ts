import { createHash } from 'crypto'
import {
  CreateAccessKeyCommand,
  CreateUserCommand,
  DeleteAccessKeyCommand,
  DeleteUserCommand,
  DeleteUserPolicyCommand,
  GetUserCommand,
  IAMClient,
  ListAccessKeysCommand,
  ListUserPoliciesCommand,
  ListUsersCommand,
  ListUserTagsCommand,
  PutUserPolicyCommand,
  User,
} from '@aws-sdk/client-iam'
import type { APIGatewayProxyEventV2WithIAMAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { validatePair } from '../lib/pairs'

/**
 * Admin API for recording pairs. Each (install, patient) pair is an IAM user
 * under PAIR_PATH, tagged with its install and sid; the user list is the
 * registry. A pair's config blob is returned once, on creation, and never stored.
 */

const iam = new IAMClient({})
const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}
const PAIR_PATH = '/librelinkward/pairs/'
const POLICY_NAME = 'write-readings'
/** Also used in the function's IAM policy (storage-stack.ts). */
export const USER_PREFIX = 'llw-pair-'

type Result = APIGatewayProxyStructuredResultV2
const json = (statusCode: number, body: unknown): Result => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
})

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Deterministic, IAM-safe user name for a pair (max 64 chars). */
export const userName = (install: string, sid: string) =>
  `${USER_PREFIX}${install.replace(/[^A-Za-z0-9_.-]/g, '_')}-${createHash('sha256').update(sid).digest('hex').slice(0, 12)}`

const tagsOf = async (name: string) => {
  const res = await iam.send(new ListUserTagsCommand({ UserName: name }))
  return Object.fromEntries((res.Tags ?? []).map((t) => [t.Key, t.Value]))
}

const exists = async (name: string) => {
  try {
    await iam.send(new GetUserCommand({ UserName: name }))
    return true
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchEntityException') return false
    throw e
  }
}

async function create(body: unknown, caller: string): Promise<Result> {
  const { install, sid } = validatePair(body as { install: string; sid: string })
  const name = userName(install, sid)
  if (await exists(name)) throw new HttpError(409, `Pair ${install} / ${sid} already exists; revoke it first to issue a new config`)
  await iam.send(new CreateUserCommand({
    UserName: name,
    Path: PAIR_PATH,
    PermissionsBoundary: env('BOUNDARY_ARN'),
    Tags: [
      { Key: 'librelinkward:install', Value: install },
      { Key: 'librelinkward:sid', Value: sid },
      { Key: 'librelinkward:created-by', Value: caller.slice(0, 256) },
    ],
  }))
  try {
    await iam.send(new PutUserPolicyCommand({
      UserName: name,
      PolicyName: POLICY_NAME,
      PolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Action: ['firehose:PutRecordBatch', 'firehose:DescribeDeliveryStream'],
          Resource: env('STREAM_ARN'),
        }],
      }),
    }))
    const key = (await iam.send(new CreateAccessKeyCommand({ UserName: name }))).AccessKey!
    const blob = Buffer.from(JSON.stringify({
      v: 1,
      region: env('AWS_REGION'),
      stream: env('STREAM_NAME'),
      accessKeyId: key.AccessKeyId,
      secretAccessKey: key.SecretAccessKey,
      sid,
      install,
    })).toString('base64')
    return json(201, { install, sid, accessKeyId: key.AccessKeyId, blob })
  } catch (e) {
    await remove(name).catch(() => {})
    throw e
  }
}

async function list(): Promise<Result> {
  const users: User[] = []
  let marker: string | undefined
  do {
    const res = await iam.send(new ListUsersCommand({ PathPrefix: PAIR_PATH, Marker: marker }))
    users.push(...(res.Users ?? []))
    marker = res.IsTruncated ? res.Marker : undefined
  } while (marker)
  const pairs = await Promise.all(users.map(async (u) => {
    const [tags, keys] = await Promise.all([
      tagsOf(u.UserName!),
      iam.send(new ListAccessKeysCommand({ UserName: u.UserName })),
    ])
    return {
      install: tags['librelinkward:install'],
      sid: tags['librelinkward:sid'],
      createdAt: u.CreateDate?.toISOString(),
      createdBy: tags['librelinkward:created-by'],
      accessKeyIds: (keys.AccessKeyMetadata ?? []).map((k) => k.AccessKeyId),
    }
  }))
  return json(200, { pairs })
}

/** Deletes a pair's keys, policies and user. */
async function remove(name: string): Promise<void> {
  const keys = await iam.send(new ListAccessKeysCommand({ UserName: name }))
  for (const k of keys.AccessKeyMetadata ?? []) {
    await iam.send(new DeleteAccessKeyCommand({ UserName: name, AccessKeyId: k.AccessKeyId }))
  }
  const policies = await iam.send(new ListUserPoliciesCommand({ UserName: name }))
  for (const p of policies.PolicyNames ?? []) {
    await iam.send(new DeleteUserPolicyCommand({ UserName: name, PolicyName: p }))
  }
  await iam.send(new DeleteUserCommand({ UserName: name }))
}

async function revoke(query: Record<string, string | undefined>): Promise<Result> {
  const { install, sid } = validatePair({ install: query.install ?? '', sid: query.sid ?? '' })
  const name = userName(install, sid)
  if (!(await exists(name))) throw new HttpError(404, `No pair ${install} / ${sid}`)
  // Only users this API created; CDK-managed pairs live elsewhere.
  const user = (await iam.send(new GetUserCommand({ UserName: name }))).User
  if (user?.Path !== PAIR_PATH) throw new HttpError(404, `No pair ${install} / ${sid}`)
  await remove(name)
  return json(200, { revoked: { install, sid } })
}

export async function handler(event: APIGatewayProxyEventV2WithIAMAuthorizer): Promise<Result> {
  const caller = event.requestContext.authorizer?.iam?.userArn ?? 'unknown'
  try {
    switch (event.routeKey) {
      case 'POST /pairs': {
        let body: unknown
        try {
          body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : event.body ?? '')
        } catch {
          throw new HttpError(400, 'Body must be JSON: {"install": "...", "sid": "..."}')
        }
        return await create(body, caller)
      }
      case 'GET /pairs':
        return await list()
      case 'DELETE /pairs':
        return await revoke(event.queryStringParameters ?? {})
      default:
        return json(404, { error: 'Not found' })
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message })
    if (e instanceof Error && e.message.startsWith('Invalid')) return json(400, { error: e.message })
    console.error(e)
    return json(500, { error: 'Internal error' })
  }
}
