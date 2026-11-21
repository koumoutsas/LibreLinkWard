import type { StoredAccount } from '../credentialStore'

/**
 * Stable id of a person's reading source, the same on every install:
 * `linkup:<LibreLinkUp patientId>` or `nightscout:<lower-case host[/path]>`.
 * It keys the recorded time series (see docs/storage-schema.md).
 */
export function sidFor(account: StoredAccount, rawPatientId: string): string {
  if (account.kind !== 'nightscout') return `linkup:${rawPatientId}`
  const url = new URL(account.url)
  const pathPart = url.pathname.replace(/\/+$/, '')
  return `nightscout:${(url.host + pathPart).toLowerCase()}`
}
