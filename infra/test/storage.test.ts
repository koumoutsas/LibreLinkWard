import * as cdk from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { parsePairs, secretName } from '../lib/pairs'
import { StorageStack } from '../lib/storage-stack'

const synth = (props: Partial<ConstructorParameters<typeof StorageStack>[2]> = {}) => {
  const app = new cdk.App()
  const stack = new StorageStack(app, 'S', {
    env: { account: '111111111111', region: 'eu-west-1' },
    pairs: [
      { install: 'desk', sid: 'linkup:abc' },
      { install: 'laptop', sid: 'nightscout:my.site/ns' },
    ],
    ...props,
  })
  return Template.fromStack(stack)
}

describe('StorageStack', () => {
  const t = synth({ analyticsPrincipal: 'arn:aws:iam::222222222222:root' })

  it('creates the readings table with identifier fields and sid partitioning', () => {
    t.hasResourceProperties('AWS::S3Tables::Table', {
      Namespace: 'librelinkward',
      TableName: 'readings',
      IcebergMetadata: {
        IcebergSchemaV2: {
          IdentifierFieldIds: [1, 2, 3],
          SchemaV2FieldList: Match.arrayWith([Match.objectLike({ Id: 5, Name: 'trend', Type: 'int', Required: false })]),
        },
        IcebergPartitionSpec: { Fields: [{ SourceId: 1, Transform: 'identity', Name: 'sid' }] },
        TableProperties: { 'format-version': '2' },
      },
    })
  })

  it('delivers to the table as upserts on (sid, t, origin)', () => {
    t.hasResourceProperties('AWS::KinesisFirehose::DeliveryStream', {
      DeliveryStreamType: 'DirectPut',
      IcebergDestinationConfiguration: Match.objectLike({
        CatalogConfiguration: { CatalogArn: 'arn:aws:glue:eu-west-1:111111111111:catalog/s3tablescatalog/librelinkward' },
        DestinationTableConfigurationList: [
          { DestinationDatabaseName: 'librelinkward', DestinationTableName: 'readings', UniqueKeys: ['sid', 't', 'origin'] },
        ],
        ProcessingConfiguration: {
          Enabled: true,
          Processors: [Match.objectLike({
            Type: 'MetadataExtraction',
            Parameters: Match.arrayWith([{ ParameterName: 'MetadataExtractionQuery', ParameterValue: '{operation: "update"}' }]),
          })],
        },
        s3BackupMode: 'FailedDataOnly',
      }),
    })
  })

  it('gives each pair a user that can only write to the stream', () => {
    t.resourceCountIs('AWS::IAM::User', 2)
    t.resourceCountIs('AWS::IAM::AccessKey', 2)
    const policies = t.findResources('AWS::IAM::Policy')
    const userPolicies = Object.values(policies).filter((p: any) => p.Properties.Users)
    expect(userPolicies).toHaveLength(2)
    for (const p of userPolicies as any[]) {
      const statements = p.Properties.PolicyDocument.Statement
      expect(statements).toHaveLength(1)
      expect(statements[0].Action).toEqual(['firehose:PutRecordBatch', 'firehose:DescribeDeliveryStream'])
      expect(statements[0].Resource).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/^Readings/), 'Arn'] })
    }
  })

  it('stores each pair blob in Secrets Manager and never outputs a secret', () => {
    t.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'librelinkward/blob/desk/linkup_abc' })
    t.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'librelinkward/blob/laptop/nightscout_my.site/ns' })
    const outputs = JSON.stringify(t.toJSON().Outputs)
    expect(outputs).not.toContain('SecretAccessKey')
  })

  it('adds a read-only analytics role only when a principal is given', () => {
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({ Principal: { AWS: 'arn:aws:iam::222222222222:root' } })],
      }),
    })
    const policies = JSON.stringify(t.toJSON().Resources)
    expect(policies).not.toMatch(/AnalyticsReader[^"]*"[^}]*PutTableData/)
    expect(synth().toJSON().Outputs.AnalyticsRoleArn).toBeUndefined()
  })

  it('can skip the catalog integration', () => {
    expect(JSON.stringify(synth({ enableCatalogIntegration: false }).toJSON())).not.toContain('createCatalog')
    expect(JSON.stringify(t.toJSON())).toContain('createCatalog')
  })
})

describe('parsePairs', () => {
  it('accepts a list or a JSON string and rejects bad input', () => {
    expect(parsePairs('[{"install":"desk","sid":"linkup:a"}]')).toEqual([{ install: 'desk', sid: 'linkup:a', serial: undefined }])
    expect(parsePairs(undefined)).toEqual([])
    expect(parsePairs('')).toEqual([])
    expect(() => parsePairs([{ install: 'bad name', sid: 'linkup:a' }])).toThrow('install')
    expect(() => parsePairs([{ install: 'desk', sid: 'abc' }])).toThrow('sid')
    expect(() => parsePairs([{ install: 'd', sid: 'linkup:a' }, { install: 'd', sid: 'linkup:a' }])).toThrow('Duplicate')
    expect(() => parsePairs('{}')).toThrow('list')
  })

  it('names secrets safely', () => {
    expect(secretName({ install: 'desk', sid: 'nightscout:a.b:8443/x' })).toBe('librelinkward/blob/desk/nightscout_a.b_8443/x')
  })
})

describe('pairs API resources', () => {
  const t = synth()

  it('exposes GET/POST/DELETE /pairs behind IAM auth', () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: `${method} /pairs`, AuthorizationType: 'AWS_IAM' })
    }
  })

  it('lets the function create users only under the pairs path and with the boundary', () => {
    const fnPolicy = Object.values(t.findResources('AWS::IAM::Policy')).find((p: any) =>
      JSON.stringify(p).includes('iam:CreateUser'),
    ) as any
    const create = fnPolicy.Properties.PolicyDocument.Statement.find((s: any) => ([] as string[]).concat(s.Action).includes('iam:CreateUser'))
    expect(create.Resource).toBe('arn:aws:iam::111111111111:user/librelinkward/pairs/*')
    expect(create.Condition.StringEquals['iam:PermissionsBoundary']).toEqual({ Ref: expect.stringMatching(/^PairBoundary/) })
    expect(JSON.stringify(t.toJSON().Outputs)).toContain('PairsApiUrl')
  })
})

describe('imports pipeline', () => {
  const t = synth()

  it('creates therapy_events keyed on (sid, t, kind, subtype), partitioned by sid', () => {
    t.hasResourceProperties('AWS::S3Tables::Table', {
      TableName: 'therapy_events',
      IcebergMetadata: {
        IcebergSchemaV2: Match.objectLike({ IdentifierFieldIds: [1, 2, 3, 4] }),
        IcebergPartitionSpec: { Fields: [{ SourceId: 1, Transform: 'identity', Name: 'sid' }] },
        TableProperties: { 'format-version': '2' },
      },
    })
    t.hasResourceProperties('AWS::KinesisFirehose::DeliveryStream', {
      IcebergDestinationConfiguration: Match.objectLike({
        DestinationTableConfigurationList: [
          { DestinationDatabaseName: 'librelinkward', DestinationTableName: 'therapy_events', UniqueKeys: ['sid', 't', 'kind', 'subtype'] },
        ],
      }),
    })
  })

  it('keeps the readings table and stream logical ids', () => {
    expect(Object.keys(t.findResources('AWS::S3Tables::Table')).sort()).toEqual(['ReadingsTable', 'TherapyEventsTable'])
    expect(Object.keys(t.findResources('AWS::KinesisFirehose::DeliveryStream')).sort()).toEqual(['Readings', 'TherapyEvents'])
  })

  it('runs the import function on uploads under raw/ with write access to both streams only', () => {
    t.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: {
        LambdaFunctionConfigurations: [Match.objectLike({
          Events: ['s3:ObjectCreated:*'],
          Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'raw/' }] } },
        })],
      },
    })
    const fnPolicy = Object.values(t.findResources('AWS::IAM::Policy')).find((p: any) =>
      JSON.stringify(p.Properties.Roles ?? []).includes('ImportFunction'),
    ) as any
    const statements = fnPolicy.Properties.PolicyDocument.Statement
    const put = statements.find((s: any) => s.Action === 'firehose:PutRecordBatch')
    expect(put.Resource).toEqual([
      { 'Fn::GetAtt': ['Readings', 'Arn'] },
      { 'Fn::GetAtt': ['TherapyEvents', 'Arn'] },
    ])
    expect(JSON.stringify(statements)).not.toMatch(/iam:|s3tables:|"s3:\*"/)
    expect(JSON.stringify(t.toJSON().Outputs)).toContain('ImportsBucketName')
  })
})
