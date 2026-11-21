import { IAMClient } from '@aws-sdk/client-iam'
import type { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda'

process.env.AWS_REGION = 'eu-central-1'
process.env.STREAM_ARN = 'arn:aws:firehose:eu-central-1:111111111111:deliverystream/s'
process.env.STREAM_NAME = 's'
process.env.BOUNDARY_ARN = 'arn:aws:iam::111111111111:policy/boundary'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler, userName } = require('../lambda/pairs') as typeof import('../lambda/pairs')

type Call = { name: string; input: Record<string, unknown> }
const notFound = () => Object.assign(new Error('nope'), { name: 'NoSuchEntityException' })

/** A tiny in-memory IAM: users by name with path, tags, policies and keys. */
function fakeIam() {
  const users = new Map<string, { path: string; tags: Record<string, string>; policies: string[]; keys: string[] }>()
  const calls: Call[] = []
  jest.spyOn(IAMClient.prototype, 'send').mockImplementation(async (cmd: any) => {
    const name = cmd.constructor.name.replace(/Command$/, '')
    const input = cmd.input
    calls.push({ name, input })
    const u = users.get(input.UserName)
    switch (name) {
      case 'GetUser':
        if (!u) throw notFound()
        return { User: { UserName: input.UserName, Path: u.path } }
      case 'CreateUser':
        users.set(input.UserName, {
          path: input.Path,
          tags: Object.fromEntries(input.Tags.map((t: any) => [t.Key, t.Value])),
          policies: [],
          keys: [],
        })
        return {}
      case 'PutUserPolicy':
        u!.policies.push(input.PolicyName)
        return {}
      case 'CreateAccessKey':
        u!.keys.push('AKIANEW')
        return { AccessKey: { AccessKeyId: 'AKIANEW', SecretAccessKey: 'shh' } }
      case 'ListUsers':
        return { Users: [...users].filter(([, v]) => v.path === input.PathPrefix).map(([n]) => ({ UserName: n, CreateDate: new Date(0) })) }
      case 'ListUserTags':
        return { Tags: Object.entries(u!.tags).map(([Key, Value]) => ({ Key, Value })) }
      case 'ListAccessKeys':
        return { AccessKeyMetadata: u!.keys.map((AccessKeyId) => ({ AccessKeyId })) }
      case 'ListUserPolicies':
        return { PolicyNames: u!.policies }
      case 'DeleteAccessKey':
        u!.keys = u!.keys.filter((k) => k !== input.AccessKeyId)
        return {}
      case 'DeleteUserPolicy':
        u!.policies = u!.policies.filter((p) => p !== input.PolicyName)
        return {}
      case 'DeleteUser':
        if (u!.keys.length || u!.policies.length) throw new Error('DeleteConflict')
        users.delete(input.UserName)
        return {}
    }
    throw new Error(`unexpected ${name}`)
  })
  return { users, calls }
}

const event = (routeKey: string, opts: { body?: unknown; query?: Record<string, string> } = {}) =>
  ({
    routeKey,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    isBase64Encoded: false,
    queryStringParameters: opts.query,
    requestContext: { authorizer: { iam: { userArn: 'arn:aws:iam::111111111111:user/admin' } } },
  }) as unknown as APIGatewayProxyEventV2WithIAMAuthorizer

const parse = (r: any) => ({ status: r.statusCode, body: JSON.parse(r.body) })

afterEach(() => jest.restoreAllMocks())

describe('pairs API', () => {
  it('creates a pair with a boundary, a stream-only policy and a config blob', async () => {
    const { users, calls } = fakeIam()
    const r = parse(await handler(event('POST /pairs', { body: { install: 'desk', sid: 'linkup:abc' } })))
    expect(r.status).toBe(201)
    const blob = JSON.parse(Buffer.from(r.body.blob, 'base64').toString())
    expect(blob).toEqual({
      v: 1, region: 'eu-central-1', stream: 's', accessKeyId: 'AKIANEW', secretAccessKey: 'shh', sid: 'linkup:abc', install: 'desk',
    })
    const create = calls.find((c) => c.name === 'CreateUser')!.input
    expect(create).toMatchObject({ Path: '/librelinkward/pairs/', PermissionsBoundary: process.env.BOUNDARY_ARN })
    const policy = JSON.parse(calls.find((c) => c.name === 'PutUserPolicy')!.input.PolicyDocument as string)
    expect(policy.Statement).toEqual([{
      Effect: 'Allow', Action: ['firehose:PutRecordBatch', 'firehose:DescribeDeliveryStream'], Resource: process.env.STREAM_ARN,
    }])
    expect(users.get(userName('desk', 'linkup:abc'))!.tags).toMatchObject({
      'librelinkward:install': 'desk', 'librelinkward:sid': 'linkup:abc', 'librelinkward:created-by': 'arn:aws:iam::111111111111:user/admin',
    })
  })

  it('refuses duplicates and bad input', async () => {
    fakeIam()
    await handler(event('POST /pairs', { body: { install: 'desk', sid: 'linkup:abc' } }))
    expect(parse(await handler(event('POST /pairs', { body: { install: 'desk', sid: 'linkup:abc' } }))).status).toBe(409)
    expect(parse(await handler(event('POST /pairs', { body: 'not json' }))).status).toBe(400)
    expect(parse(await handler(event('POST /pairs', { body: { install: 'a b', sid: 'linkup:abc' } }))).status).toBe(400)
    expect(parse(await handler(event('POST /pairs', { body: { install: 'desk', sid: 'linkup:a?b' } }))).status).toBe(400)
  })

  it('lists and revokes pairs', async () => {
    const { users } = fakeIam()
    await handler(event('POST /pairs', { body: { install: 'desk', sid: 'linkup:abc' } }))
    await handler(event('POST /pairs', { body: { install: 'laptop', sid: 'nightscout:my.site/ns' } }))
    const listed = parse(await handler(event('GET /pairs')))
    expect(listed.body.pairs.map((p: any) => `${p.install} ${p.sid}`).sort()).toEqual(['desk linkup:abc', 'laptop nightscout:my.site/ns'])

    const revoked = parse(await handler(event('DELETE /pairs', { query: { install: 'desk', sid: 'linkup:abc' } })))
    expect(revoked).toEqual({ status: 200, body: { revoked: { install: 'desk', sid: 'linkup:abc' } } })
    expect(users.has(userName('desk', 'linkup:abc'))).toBe(false)
    expect(parse(await handler(event('DELETE /pairs', { query: { install: 'desk', sid: 'linkup:abc' } }))).status).toBe(404)
  })

  it('does not revoke users outside the pairs path', async () => {
    const { users } = fakeIam()
    users.set(userName('desk', 'linkup:abc'), { path: '/', tags: {}, policies: [], keys: [] })
    expect(parse(await handler(event('DELETE /pairs', { query: { install: 'desk', sid: 'linkup:abc' } }))).status).toBe(404)
    expect(users.size).toBe(1)
  })

  it('cleans up a half-created pair and hides internal errors', async () => {
    const { users } = fakeIam()
    const send = IAMClient.prototype.send as jest.Mock
    const real = send.getMockImplementation()!
    send.mockImplementation(async (cmd: any) => {
      if (cmd.constructor.name === 'CreateAccessKeyCommand') throw new Error('LimitExceeded')
      return real(cmd)
    })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const r = parse(await handler(event('POST /pairs', { body: { install: 'desk', sid: 'linkup:abc' } })))
    expect(r).toEqual({ status: 500, body: { error: 'Internal error' } })
    expect(users.size).toBe(0)
  })

  it('names users deterministically within IAM limits', () => {
    const name = userName('a'.repeat(41), 'nightscout:' + 'x'.repeat(200))
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toBe(userName('a'.repeat(41), 'nightscout:' + 'x'.repeat(200)))
    expect(userName('desk', 'linkup:a')).not.toBe(userName('desk', 'linkup:b'))
    expect(parse({ statusCode: 404, body: '{}' }).status).toBe(404)
  })
})
