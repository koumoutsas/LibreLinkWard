#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { parsePairs } from '../lib/pairs'
import { StorageStack } from '../lib/storage-stack'

const app = new cdk.App()
new StorageStack(app, 'LibreLinkWardStorage', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  pairs: parsePairs(app.node.tryGetContext('pairs')),
  analyticsPrincipal: app.node.tryGetContext('analyticsPrincipal') || undefined,
  enableCatalogIntegration: String(app.node.tryGetContext('enableCatalogIntegration')) !== 'false',
  terminationProtection: true,
})
