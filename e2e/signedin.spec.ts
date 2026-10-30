import { expect, test } from '@playwright/test'
import { startMockNightscout } from '../src/__tests__/helpers/mockServers'
import { launchApp } from './helpers'

// Signed in as far as the renderer is concerned (LibreLinkUp itself cannot be redirected to a mock),
// then a Nightscout site served locally provides the readings.
const AUTH = JSON.stringify({ state: { token: 't', accountId: 'a', country: 'global', language: 'en', resultUnit: 'mg/dL' }, version: 0 })

test('signed in: add a Nightscout patient, open it, change settings and remove the login', async () => {
  const ns = await startMockNightscout('ns-secret')
  ns.state.entries.push({ date: Date.now() - 60_000, sgv: 123, direction: 'Flat' })
  const { app, cleanup } = await launchApp()
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.evaluate((auth) => localStorage.setItem('auth-storage', auth), AUTH)
    await win.reload()

    // Dashboard, empty.
    await expect(win.getByRole('heading', { name: 'Patients' })).toBeVisible({ timeout: 20_000 })
    await expect(win.getByTestId('no-patients')).toBeVisible()

    // Add a Nightscout site.
    await win.getByLabel('Add patient').click()
    await win.getByLabel('Reading source').selectOption('nightscout')
    await win.getByPlaceholder('https://my-site.example.com').fill(ns.url)
    await win.getByPlaceholder('API secret (blank if public)').fill('ns-secret')
    await win.getByPlaceholder('Patient name (optional)').fill('Kid')
    await win.getByRole('button', { name: 'Add', exact: true }).click()

    const card = win.locator('[data-testid^="patient-card-"]')
    await expect(card).toContainText('Kid', { timeout: 30_000 })
    await expect(card).toContainText('123')

    // Patient page.
    await card.click()
    await expect(win.getByRole('heading', { name: 'Kid' })).toBeVisible()
    await win.getByRole('button', { name: '12 h' }).click()
    await expect(win.getByTestId('patient-graph')).toBeVisible()
    await win.getByRole('button', { name: 'Patients' }).click()

    // Settings open in their own window.
    const [settings] = await Promise.all([app.waitForEvent('window'), win.getByLabel('Settings').click()])
    await expect(settings.getByText('System Tray')).toBeVisible({ timeout: 20_000 })
    await settings.getByText('Accounts').click()
    await expect(settings.getByTestId('nightscout-site-settings')).toBeVisible()
    await expect(settings.getByLabel('Nightscout site URL')).toHaveValue(ns.url)

    // Removing the login empties the dashboard.
    await win.getByRole('button', { name: /^Remove / }).click()
    await expect(win.getByTestId('no-patients')).toBeVisible({ timeout: 20_000 })
  } finally {
    await cleanup()
    await ns.stop()
  }
})
