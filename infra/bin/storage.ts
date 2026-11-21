#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import fs from 'fs'
import path from 'path'
import { parsePairs } from '../lib/pairs'
import { StorageStack } from '../lib/storage-stack'

const app = new cdk.App()

// Pairs name patients, so a deployment keeps them out of git: `-c pairs=...` wins,
// otherwise pairs.local.json (gitignored) next to cdk.json.
const localPairs = path.join(__dirname, '..', 'pairs.local.json')
const pairsContext =
  app.node.tryGetContext('pairs') ?? (fs.existsSync(localPairs) ? fs.readFileSync(localPairs, 'utf8') : undefined)
new StorageStack(app, 'LibreLinkWardStorage', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  pairs: parsePairs(pairsContext),
  analyticsPrincipal: app.node.tryGetContext('analyticsPrincipal') || undefined,
  enableCatalogIntegration: String(app.node.tryGetContext('enableCatalogIntegration')) !== 'false',
  terminationProtection: true,
})
