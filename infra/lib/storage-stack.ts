import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import { CfnOutput, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib'
import * as custom from 'aws-cdk-lib/custom-resources'
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3n from 'aws-cdk-lib/aws-s3-notifications'
import * as s3tables from 'aws-cdk-lib/aws-s3tables'
import * as secrets from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'
import { Pair, pairKey, secretName } from './pairs'
import { EVENT_FIELDS, EVENT_UNIQUE_KEYS, EVENTS_TABLE, FIELDS, NAMESPACE, TABLE, UNIQUE_KEYS } from './schema'

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

    const table = icebergTable(this, 'ReadingsTable', bucket, TABLE, FIELDS, UNIQUE_KEYS)
    table.addResourceDependency(namespace)
    table.applyRemovalPolicy(RemovalPolicy.RETAIN)

    const eventsTable = icebergTable(this, 'TherapyEventsTable', bucket, EVENTS_TABLE, EVENT_FIELDS, EVENT_UNIQUE_KEYS)
    eventsTable.addResourceDependency(namespace)
    eventsTable.applyRemovalPolicy(RemovalPolicy.RETAIN)

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
      eventsTable.node.addDependency(integration)
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

    const delivery = { role, errors, logGroup, catalogArn: `arn:aws:glue:${region}:${account}:catalog/s3tablescatalog/${bucketName}` }
    const stream = deliveryStream(this, 'Readings', { ...delivery, table: TABLE, uniqueKeys: UNIQUE_KEYS, logStream, errorPrefix: 'errors/' })
    stream.node.addDependency(role)
    stream.addResourceDependency(table)

    const eventsStream = deliveryStream(this, 'TherapyEvents', {
      ...delivery,
      table: EVENTS_TABLE,
      uniqueKeys: EVENT_UNIQUE_KEYS,
      logStream: new logs.LogStream(this, 'EventsDeliveryLogStream', { logGroup }),
      errorPrefix: 'errors/therapy_events/',
    })
    eventsStream.node.addDependency(role)
    eventsStream.addResourceDependency(eventsTable)

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

    this.pairsApi(stream)
    this.importsPipeline(stream, eventsStream)

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
    new CfnOutput(this, 'EventsTableIdentifier', { value: `s3tablescatalog/${bucketName}.${NAMESPACE}.${EVENTS_TABLE}` })
    new CfnOutput(this, 'Pairs', { value: props.pairs.map(secretName).join(' ') || '(none)' })
  }

  /**
   * Backfill from exports: scripts/import.ts uploads a file to raw/ in the
   * imports bucket (kept, so it can be re-imported by a newer parser), and a
   * function parses it into the readings and therapy_events streams. Writing
   * needs your own AWS credentials with s3:PutObject on the bucket.
   */
  private importsPipeline(readings: firehose.CfnDeliveryStream, events: firehose.CfnDeliveryStream): void {
    const imports = new s3.Bucket(this, 'Imports', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    const fn = new nodejs.NodejsFunction(this, 'ImportFunction', {
      entry: path.join(__dirname, '..', 'lambda', 'import.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: { READINGS_STREAM: readings.ref, EVENTS_STREAM: events.ref },
      bundling: { externalModules: ['@aws-sdk/*'], minify: true },
      logGroup: new logs.LogGroup(this, 'ImportLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    })
    imports.grantRead(fn, 'raw/*')
    imports.grantPut(fn, 'results/*')
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['firehose:PutRecordBatch'],
      resources: [readings.attrArn, events.attrArn],
    }))
    imports.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(fn), { prefix: 'raw/' })
    new CfnOutput(this, 'ImportsBucketName', { value: imports.bucketName })
  }

  /**
   * Admin API (IAM-authenticated) that issues, lists and revokes pairs at run
   * time. Users it creates live under /librelinkward/pairs/ and carry a
   * permissions boundary that allows nothing but writing to this stream.
   */
  private pairsApi(stream: firehose.CfnDeliveryStream): void {
    const { account } = this
    const boundary = new iam.ManagedPolicy(this, 'PairBoundary', {
      description: 'Upper bound for LibreLinkWard pair users: write readings only',
      statements: [new iam.PolicyStatement({
        actions: ['firehose:PutRecordBatch', 'firehose:DescribeDeliveryStream'],
        resources: [stream.attrArn],
      })],
    })
    const pairUsers = `arn:aws:iam::${account}:user/librelinkward/pairs/*`

    const fn = new nodejs.NodejsFunction(this, 'PairsFunction', {
      entry: path.join(__dirname, '..', 'lambda', 'pairs.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        STREAM_ARN: stream.attrArn,
        STREAM_NAME: stream.ref,
        BOUNDARY_ARN: boundary.managedPolicyArn,
      },
      bundling: { externalModules: ['@aws-sdk/*'], minify: true },
      logGroup: new logs.LogGroup(this, 'PairsLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    })
    // Creating users and attaching policies only works with the boundary attached.
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:CreateUser', 'iam:PutUserPolicy'],
      resources: [pairUsers],
      conditions: { StringEquals: { 'iam:PermissionsBoundary': boundary.managedPolicyArn } },
    }))
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'iam:GetUser', 'iam:TagUser', 'iam:ListUserTags', 'iam:DeleteUser',
        'iam:CreateAccessKey', 'iam:ListAccessKeys', 'iam:DeleteAccessKey',
        'iam:ListUserPolicies', 'iam:DeleteUserPolicy',
      ],
      resources: [pairUsers],
    }))
    // A user that does not exist yet is checked as user/<name>, without its path.
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:GetUser'],
      resources: [`arn:aws:iam::${account}:user/llw-pair-*`],
    }))
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:ListUsers'], resources: ['*'] }))

    const api = new apigw.HttpApi(this, 'PairsApi', {
      description: 'LibreLinkWard pair administration (IAM auth)',
      defaultAuthorizer: new HttpIamAuthorizer(),
    })
    const integration = new HttpLambdaIntegration('PairsIntegration', fn)
    api.addRoutes({
      path: '/pairs',
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST, apigw.HttpMethod.DELETE],
      integration,
    })
    new CfnOutput(this, 'PairsApiUrl', { value: api.apiEndpoint })
  }
}

type Field = { id: number; name: string; type: string; required: boolean; doc: string }

/** An Iceberg v2 table partitioned by sid, with `keys` as identifier fields. */
function icebergTable(scope: Construct, id: string, bucket: s3tables.CfnTableBucket, name: string, fields: readonly Field[], keys: string[]) {
  return new s3tables.CfnTable(scope, id, {
    tableBucketArn: bucket.attrTableBucketArn,
    namespace: NAMESPACE,
    tableName: name,
    openTableFormat: 'ICEBERG',
    icebergMetadata: {
      icebergSchemaV2: {
        schemaV2FieldType: 'struct',
        schemaV2FieldList: fields.map((f) => ({ id: f.id, name: f.name, type: f.type, required: f.required, doc: f.doc })),
        identifierFieldIds: fields.filter((f) => keys.includes(f.name)).map((f) => f.id),
      },
      icebergPartitionSpec: {
        fields: [{ sourceId: fields.find((f) => f.name === 'sid')!.id, transform: 'identity', name: 'sid' }],
      },
      // Firehose delivers to format-version 2 tables only.
      tableProperties: { 'format-version': '2' },
    },
  })
}

type DeliveryProps = {
  role: iam.Role
  errors: s3.Bucket
  logGroup: logs.LogGroup
  logStream: logs.LogStream
  catalogArn: string
  table: string
  uniqueKeys: string[]
  errorPrefix: string
}

/** A Direct PUT stream that upserts every record into `table` on `uniqueKeys`. */
function deliveryStream(scope: Construct, id: string, p: DeliveryProps) {
  return new firehose.CfnDeliveryStream(scope, id, {
    deliveryStreamType: 'DirectPut',
    icebergDestinationConfiguration: {
      roleArn: p.role.roleArn,
      catalogConfiguration: { catalogArn: p.catalogArn },
      destinationTableConfigurationList: [
        { destinationDatabaseName: NAMESPACE, destinationTableName: p.table, uniqueKeys: p.uniqueKeys },
      ],
      // Every record is an update: inserts new keys, replaces identical rows sent by other installs or imports.
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
        bucketArn: p.errors.bucketArn,
        roleArn: p.role.roleArn,
        errorOutputPrefix: p.errorPrefix,
      },
      cloudWatchLoggingOptions: { enabled: true, logGroupName: p.logGroup.logGroupName, logStreamName: p.logStream.logStreamName },
    },
  })
}
