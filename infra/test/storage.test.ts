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
