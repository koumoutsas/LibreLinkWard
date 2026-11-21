# Recording readings to AWS

LibreLinkWard can keep every reading of chosen patients in your own AWS account for offline analysis. Clients send readings to an Amazon Data Firehose stream, which writes them into an Iceberg table in Amazon S3 Tables. The table is described in [storage-schema.md](storage-schema.md).

Each family or ward deploys its own copy of the stack into its own AWS account. Nothing is sent to the LibreLinkWard developers.

## Cost

Usage costs are well under $1 a month for a handful of patients: Firehose delivery, S3 Tables storage and compaction. Athena queries cost $5 per TB scanned. Pairs issued through the admin API cost nothing. Pairs managed by CDK keep their config in Secrets Manager, at about $0.40 a month each.

## 1. Deploy the stack

You need Node 22, AWS credentials for the target account, and a [bootstrapped](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) CDK environment.

```sh
cd infra
npm install
export AWS_REGION=eu-central-1   # the Region to keep the data in; use the same one every time
npx cdk bootstrap                # once per account and Region
npx cdk deploy
```

The stack deploys to the Region of your AWS credentials, or to `AWS_REGION` if set. Deploying later from a shell with a different Region creates a second, separate copy, so always set the same Region.

Things to know before deploying:

- **Catalog integration.** The stack turns on the account-wide S3 Tables integration with the AWS analytics services. This is the `s3tablescatalog` in the Glue Data Catalog, using IAM access control. If it is already on, the stack leaves it as it is. Pass `-c enableCatalogIntegration=false` to skip this step.
  - **Lake Formation mode:** if your account uses Lake Formation for S3 Tables, also grant the stack's `DeliveryRole` `ALL` on the `readings` table in Lake Formation.
- **Data is kept when the stack goes.** The stack has termination protection. The table bucket, the table and the error bucket are kept even if you delete the stack.

## 2. Issue a config for each install and patient

Each computer that should record a patient needs its own config. This lets you see who wrote what and revoke one computer without affecting the others.

1. **Get the patient id.** In LibreLinkWard, open **Settings > Accounts**. Under the patient, **Data recording** shows the patient id (for example `linkup:1a2b…`). Press **Copy**.
2. **Create the pair** with the admin API. The stack outputs its URL as `PairsApiUrl`, and `infra/scripts/pairs.ts` calls it with your own AWS credentials, which need `execute-api:Invoke` on it; account admins have this. Install names may use letters, digits, `.`, `_` and `-`.
   ```sh
   cd infra
   export AWS_REGION=eu-central-1
   npx ts-node scripts/pairs.ts create ward-desk linkup:1a2b…
   ```
   The config is copied to the clipboard (macOS). Add `--print` to print it instead. **It is shown only this once.** If it is lost, revoke the pair and create it again.
3. **Install it on the matching computer.** Paste the config into **Data recording** for that patient and press **Save**. The app rejects a config issued for another patient. Press **Test connection**, then turn on **Record this patient**. A brand-new key can take up to a minute to work; if the first test fails, try again.

Recording only sends readings from the moment it is turned on. Turning it off discards anything not yet sent.

```sh
npx ts-node scripts/pairs.ts list                          # install, patient id, created, created by
npx ts-node scripts/pairs.ts revoke ward-desk linkup:1a2b…
```

**Revoke** deletes the pair's IAM user and key. AWS takes a few minutes to stop accepting the key everywhere; about 4 minutes in our test. After that the install shows "Recording stopped". **To rotate a key,** revoke the pair and create it again, then paste the new config.

### How the API is protected

- **Who can call it:** only signed AWS requests from principals in this account with `execute-api:Invoke`; unsigned calls get 403.
- **What its function can create:** IAM users under the path `/librelinkward/pairs/` only, and only with a permissions boundary that allows nothing beyond writing to this stream.
- **What it stores:** nothing besides those IAM users. Each user is tagged with its install, patient id and the admin who created it, and that user list is the registry. Configs are not stored anywhere.

### Pairs managed by CDK (older method)

Pairs listed in the gitignored `infra/pairs.local.json` are still created on every deploy, with their config stored in Secrets Manager (about $0.40 a month each):
- **Print a config:** `scripts/blob.sh <install> <sid> <region>`.
- **Revoke:** remove the entry and deploy again.

`pairs.ts list` and `revoke` don't see these pairs. Prefer the API for new pairs.

## Backfilling from exports

Gaps where no install was recording can be filled from exports. Pump data, for example an Omnipod DASH PDM, can be added the same way. The first supported format is the **Glooko** CSV export. It holds CGM data that Glooko pulled from LibreView alongside the pump's boluses, basal, alarms and BG readings, plus logged food.

1. **Export.** In Glooko, upload the PDM, then choose _Export to CSV_ for a date range. You get a zip such as `export_<name>.zip`.
2. **Get the patient id.** The id comes from **Settings > Accounts > Data recording**, as above, for example `linkup:1a2b…`. Backfilled rows must use the same id as the live data so the two can be combined.
3. **Check the file locally.** This parses the file and prints counts and warnings without uploading anything. The export's times are local wall-clock times, so give the time zone the device was set to:
   ```sh
   cd infra
   npx ts-node scripts/import.ts glooko linkup:1a2b… ~/Downloads/export.zip --tz Europe/Athens --check
   ```
4. **Import it.** Run the same command without `--check`, with `AWS_REGION` set. Your AWS credentials need `s3:PutObject`, `s3:GetObject` and `s3:ListBucket` on the stack's `ImportsBucketName`; account admins have these.
   - The CLI uploads the zip and waits for the import function to finish.
   - CGM points go to `readings` with origin `import`. Everything else goes to `therapy_events`, as described in [storage-schema.md](storage-schema.md).
   - Rows show up in about five minutes.
5. **List imports** with `npx ts-node scripts/import.ts list`.

**Re-importing is safe.** Importing the same or an overlapping export again replaces the rows; nothing is duplicated, so exporting overlapping ranges is fine.

**The raw export is kept.** The uploaded zip stays in the imports bucket under `raw/`, so a later importer can process it again. It is encrypted and private, and contains the patient's name as Glooko wrote it; the tables never store the name.

**Time changes.** A time that happened twice when the clocks went back is stored as the earlier instant, with a warning.

**Size limits.** Each file inside the export can be at most 64 MB, and the import function has 1 GB of memory and 5 minutes. Real exports are a few MB. For a design that handles larger files, see [large-imports-design.md](large-imports-design.md).

**Removing an import:** `DELETE FROM … readings WHERE install = 'import:<id>'` and `DELETE FROM … therapy_events WHERE import_id = '<id>'` in Athena.

## Analytics access

Deploy with `-c analyticsPrincipal=arn:aws:iam::<account>:role/<role>` to get a read-only `AnalyticsRoleArn` output. That role can read the table through the Glue catalog, and nothing else. Your analytics jobs assume it.

Failed deliveries land in the stack's error bucket under `errors/` and are kept for 30 days. Delivery logs go to CloudWatch.
