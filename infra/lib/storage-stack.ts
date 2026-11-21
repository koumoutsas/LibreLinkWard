import * as cdk from 'aws-cdk-lib'
import { CfnOutput, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib'
import * as custom from 'aws-cdk-lib/custom-resources'
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3tables from 'aws-cdk-lib/aws-s3tables'
import * as secrets from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'
import { Pair, pairKey, secretName } from './pairs'
import { FIELDS, NAMESPACE, TABLE, UNIQUE_KEYS } from './schema'

export type StorageStackProps = StackProps & {
  pairs: Pair[]
  /** ARN of a principal (account root, role or user) allowed to read the table. */
  analyticsPrincipal?: string
  /** Creates the account-wide s3tablescatalog (IAM mode) if it does not exist yet. */
  enableCatalogIntegration?: boolean
}

/**
 * Storage for LibreLinkWard readings: clients PutRecordBatch into a Firehose
 * stream, which upserts into an Iceberg table in S3 Tables keyed on
 * (sid, t, origin). Every (install, patient) pair gets its own IAM user whose
 * only rights are writing to that stream, and a ready-to-paste config blob.
 */
export class StorageStack extends Stack {
  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props)
    const { account, region } = this

    const bucket = new s3tables.CfnTableBucket(this, 'TableBucket', {
      tableBucketName: 'librelinkward',
    })
    bucket.applyRemovalPolicy(RemovalPolicy.RETAIN)

    const namespace = new s3tables.CfnNamespace(this, 'Namespace', {
      namespace: NAMESPACE,
      tableBucketArn: bucket.attrTableBucketArn,
    })
    namespace.applyRemovalPolicy(RemovalPolicy.RETAIN)

    const table = new s3tables.CfnTable(this, 'ReadingsTable', {
      tableBucketArn: bucket.attrTableBucketArn,
      namespace: NAMESPACE,
      tableName: TABLE,
      openTableFormat: 'ICEBERG',
      icebergMetadata: {
        icebergSchemaV2: {
          schemaV2FieldType: 'struct',
          schemaV2FieldList: FIELDS.map((f) => ({ id: f.id, name: f.name, type: f.type, required: f.required, doc: f.doc })),
          identifierFieldIds: FIELDS.filter((f) => UNIQUE_KEYS.includes(f.name)).map((f) => f.id),
        },
        icebergPartitionSpec: {
          fields: [{ sourceId: FIELDS.find((f) => f.name === 'sid')!.id, transform: 'identity', name: 'sid' }],
        },
        // Firehose delivers to format-version 2 tables only.
        tableProperties: { 'format-version': '2' },
      },
    })
    table.addResourceDependency(namespace)
    table.applyRemovalPolicy(RemovalPolicy.RETAIN)

    if (props.enableCatalogIntegration ?? true) {
      // One-time, account+Region: exposes table buckets to Glue/Athena/Firehose with IAM access control.
      const integration = new custom.AwsCustomResource(this, 'S3TablesCatalogIntegration', {
        onCreate: {
          service: 'Glue',
          action: 'createCatalog',
          parameters: {
            Name: 's3tablescatalog',
            CatalogInput: {
              FederatedCatalog: { Identifier: `arn:aws:s3tables:${region}:${account}:bucket/*`, ConnectionName: 'aws:s3tables' },
              CreateDatabaseDefaultPermissions: [{ Principal: { DataLakePrincipalIdentifier: 'IAM_ALLOWED_PRINCIPALS' }, Permissions: ['ALL'] }],
              CreateTableDefaultPermissions: [{ Principal: { DataLakePrincipalIdentifier: 'IAM_ALLOWED_PRINCIPALS' }, Permissions: ['ALL'] }],
            },
          },
          physicalResourceId: custom.PhysicalResourceId.of('s3tablescatalog'),
          // Already integrated (console or another stack): nothing to do.
          ignoreErrorCodesMatching: 'AlreadyExistsException',
        },
        // Account-wide; never removed with this stack.
        installLatestAwsSdk: false,
        policy: custom.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['glue:CreateCatalog', 'glue:GetCatalog', 'glue:PassConnection', 'lakeformation:RegisterResource', 'lakeformation:GetDataAccess', 's3tables:ListTableBuckets', 'iam:PassRole'],
            resources: ['*'],
          }),
        ]),
      })
      table.node.addDependency(integration)
    }

    const errors = new s3.Bucket(this, 'DeliveryErrors', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      removalPolicy: RemovalPolicy.RETAIN,
    })
    const logGroup = new logs.LogGroup(this, 'DeliveryLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const logStream = new logs.LogStream(this, 'DeliveryLogStream', { logGroup })

    const bucketName = 'librelinkward'
    const role = new iam.Role(this, 'DeliveryRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com', {
        conditions: { StringEquals: { 'sts:ExternalId': account } },
      }),
    })
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['s3tables:GetTableBucket', 's3tables:GetNamespace', 's3tables:GetTable', 's3tables:GetTableData', 's3tables:GetTableMetadataLocation', 's3tables:PutTableData', 's3tables:UpdateTableMetadataLocation'],
      resources: [bucket.attrTableBucketArn, `${bucket.attrTableBucketArn}/table/*`],
    }))
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['glue:GetCatalog', 'glue:GetDatabase', 'glue:GetDatabases', 'glue:GetTable', 'glue:GetTables', 'glue:UpdateTable'],
      resources: [
        `arn:aws:glue:${region}:${account}:catalog`,
        `arn:aws:glue:${region}:${account}:catalog/s3tablescatalog`,
        `arn:aws:glue:${region}:${account}:catalog/s3tablescatalog/${bucketName}`,
        `arn:aws:glue:${region}:${account}:database/s3tablescatalog/${bucketName}/${NAMESPACE}`,
        `arn:aws:glue:${region}:${account}:table/s3tablescatalog/${bucketName}/${NAMESPACE}/*`,
      ],
    }))
    errors.grantReadWrite(role)
    logGroup.grantWrite(role)

    const stream = new firehose.CfnDeliveryStream(this, 'Readings', {
      deliveryStreamType: 'DirectPut',
      icebergDestinationConfiguration: {
        roleArn: role.roleArn,
        catalogConfiguration: { catalogArn: `arn:aws:glue:${region}:${account}:catalog/s3tablescatalog/${bucketName}` },
        destinationTableConfigurationList: [
          { destinationDatabaseName: NAMESPACE, destinationTableName: TABLE, uniqueKeys: UNIQUE_KEYS },
        ],
        // Every record is an update: inserts new keys, replaces identical rows sent by other installs.
        processingConfiguration: {
          enabled: true,
          processors: [{
            type: 'MetadataExtraction',
            parameters: [
              { parameterName: 'JsonParsingEngine', parameterValue: 'JQ-1.6' },
              { parameterName: 'MetadataExtractionQuery', parameterValue: '{operation: "update"}' },
            ],
          }],
        },
        bufferingHints: { intervalInSeconds: 300, sizeInMBs: 5 },
        retryOptions: { durationInSeconds: 3600 },
        s3BackupMode: 'FailedDataOnly',
        s3Configuration: {
          bucketArn: errors.bucketArn,
          roleArn: role.roleArn,
          errorOutputPrefix: 'errors/',
        },
        cloudWatchLoggingOptions: { enabled: true, logGroupName: logGroup.logGroupName, logStreamName: logStream.logStreamName },
      },
    })
    stream.node.addDependency(role)
    stream.addResourceDependency(table)

    // One IAM user per (install, patient): audit and revocation, nothing else.
    for (const pair of props.pairs) {
      const pairId = `Pair-${pairKey(pair).replace(/[^A-Za-z0-9]/g, '-')}`
      const scopeConstruct = new Construct(this, pairId)
      const user = new iam.User(scopeConstruct, 'User')
      cdk.Tags.of(user).add('librelinkward:install', pair.install)
      cdk.Tags.of(user).add('librelinkward:sid', pair.sid.slice(0, 256))
      user.addToPolicy(new iam.PolicyStatement({
        actions: ['firehose:PutRecordBatch', 'firehose:DescribeDeliveryStream'],
        resources: [stream.attrArn],
      }))
      const key = new iam.AccessKey(scopeConstruct, 'Key', { user, serial: pair.serial })
      const blobJson = Fn.join('', [
        '{"v":1,"region":"', region,
        '","stream":"', stream.ref,
        '","accessKeyId":"', key.accessKeyId,
        '","secretAccessKey":"', key.secretAccessKey.unsafeUnwrap(),
        '","sid":', JSON.stringify(pair.sid),
        ',"install":', JSON.stringify(pair.install), '}',
      ])
      new secrets.Secret(scopeConstruct, 'Blob', {
        secretName: secretName(pair),
        description: `LibreLinkWard recording config for ${pair.install} / ${pair.sid}`,
        secretStringValue: cdk.SecretValue.unsafePlainText(Fn.base64(blobJson)),
      })
    }

    if (props.analyticsPrincipal) {
      const reader = new iam.Role(this, 'AnalyticsReader', {
        assumedBy: new iam.ArnPrincipal(props.analyticsPrincipal),
        description: 'Read-only access to the LibreLinkWard readings table',
      })
      reader.addToPolicy(new iam.PolicyStatement({
        actions: ['glue:GetCatalog', 'glue:GetCatalogs', 'glue:GetDatabase', 'glue:GetDatabases', 'glue:GetTable', 'glue:GetTables'],
        resources: [
          `arn:aws:glue:${region}:${account}:catalog`,
          `arn:aws:glue:${region}:${account}:catalog/s3tablescatalog`,
          `arn:aws:glue:${region}:${account}:catalog/s3tablescatalog/${bucketName}`,
          `arn:aws:glue:${region}:${account}:database/s3tablescatalog/${bucketName}/${NAMESPACE}`,
          `arn:aws:glue:${region}:${account}:table/s3tablescatalog/${bucketName}/${NAMESPACE}/*`,
        ],
      }))
      reader.addToPolicy(new iam.PolicyStatement({
        actions: ['s3tables:GetTableBucket', 's3tables:ListNamespaces', 's3tables:GetNamespace', 's3tables:ListTables', 's3tables:GetTable', 's3tables:GetTableMetadataLocation', 's3tables:GetTableData'],
        resources: [bucket.attrTableBucketArn, `${bucket.attrTableBucketArn}/table/*`],
      }))
      new CfnOutput(this, 'AnalyticsRoleArn', { value: reader.roleArn })
    }

    new CfnOutput(this, 'StreamName', { value: stream.ref })
    new CfnOutput(this, 'TableIdentifier', { value: `s3tablescatalog/${bucketName}.${NAMESPACE}.${TABLE}` })
    new CfnOutput(this, 'Pairs', { value: props.pairs.map(secretName).join(' ') || '(none)' })
  }
}
