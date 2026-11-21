# Recording readings to AWS

LibreLinkWard can keep every reading of chosen patients in your own AWS account for offline analysis. Clients send readings to an Amazon Data Firehose stream, which writes them into an Iceberg table in Amazon S3 Tables. The table is described in [storage-schema.md](storage-schema.md).

Each family or ward deploys its own copy of the stack into its own AWS account. Nothing is sent to the LibreLinkWard developers.

## Cost

Usage costs are well under $1 a month for a handful of patients: Firehose delivery, S3 Tables storage and compaction. Athena queries cost $5 per TB scanned. The one fixed cost is Secrets Manager, about $0.40 a month for each (install, patient) pair's stored config.

## 1. Deploy the stack

You need Node 22, AWS credentials for the target account, and a [bootstrapped](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) CDK environment.

```sh
cd infra
npm install
npx cdk bootstrap            # once per account and Region
npx cdk deploy
```

Things to know before deploying:

- **Catalog integration.** The stack turns on the account-wide S3 Tables integration with the AWS analytics services. This is the `s3tablescatalog` in the Glue Data Catalog, using IAM access control. If it is already on, the stack leaves it as it is. Pass `-c enableCatalogIntegration=false` to skip this step.
  - **Lake Formation mode:** if your account uses Lake Formation for S3 Tables, also grant the stack's `DeliveryRole` `ALL` on the `readings` table in Lake Formation.
- **Data is kept when the stack goes.** The stack has termination protection. The table bucket, the table and the error bucket are kept even if you delete the stack.

## 2. Issue a config for each install and patient

Each computer that should record a patient needs its own config. This lets you see who wrote what and revoke one computer without affecting the others.

1. **Get the patient id.** In LibreLinkWard, open **Settings > Accounts**. Under the patient, **Data recording** shows the patient id (for example `linkup:1a2b…`). Press **Copy**.
2. **List the pairs.** Add every (install, patient) pair to `infra/cdk.json`, or pass them on the command line. Install names may use letters, digits, `.`, `_` and `-`.
   ```sh
   npx cdk deploy -c 'pairs=[{"install":"ward-desk","sid":"linkup:1a2b…"},{"install":"home-mac","sid":"linkup:1a2b…"}]'
   ```
3. **Print each config:**
   ```sh
   scripts/blob.sh ward-desk linkup:1a2b…
   ```
4. **Install it on the matching computer.** Paste the config into **Data recording** for that patient and press **Save**. The app rejects a config issued for another patient. Press **Test connection**, then turn on **Record this patient**.

Recording only sends readings from the moment it is turned on. Turning it off discards anything not yet sent.

## Revoke or rotate

- **Revoke:** remove the pair from `pairs` and deploy again. Its IAM user and key are deleted, and that install shows "Recording stopped".
- **Rotate a key:** add `"serial": 1` to the pair (or increase it), deploy, then paste the new config on that computer.

## Analytics access

Deploy with `-c analyticsPrincipal=arn:aws:iam::<account>:role/<role>` to get a read-only `AnalyticsRoleArn` output. That role can read the table through the Glue catalog, and nothing else. Your analytics jobs assume it.

Failed deliveries land in the stack's error bucket under `errors/` and are kept for 30 days. Delivery logs go to CloudWatch.
