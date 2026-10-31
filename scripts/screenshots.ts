// Regenerates the README screenshots from the packaged app (`npm run package:dir` first).
// Patients are fictional: three mock Nightscout sites serve generated 12 h glucose traces.
// Usage: npm run screenshots
import fs from 'fs'
import path from 'path'
import { type Page } from '@playwright/test'
import { launchApp } from '../e2e/helpers'
import { startMockNightscout } from '../src/__tests__/helpers/mockServers'

const OUT = path.join(__dirname, '..', 'docs', 'screenshots')
const SECRET = 'ns-secret'
const READING_MS = 5 * 60 * 1000
const HISTORY_MS = 12 * 60 * 60 * 1000

type Patient = { name: string; current: number; direction: string; swing: number; phase: number }

const PATIENTS: Patient[] = [
  { name: 'Alex', current: 112, direction: 'Flat', swing: 30, phase: 1 },
  { name: 'Jordan', current: 205, direction: 'SingleUp', swing: 45, phase: 0.4 },
  { name: 'Riley', current: 63, direction: 'SingleDown', swing: 20, phase: 3.1 },
]

/** A smooth, slightly noisy trace that ends exactly on `current`, newest reading one minute ago. */
function trace({ current, direction, swing, phase }: Patient) {
  const newest = Date.now() - 60_000
  const count = Math.floor(HISTORY_MS / READING_MS)
  return Array.from({ length: count }, (_, i) => {
    const wave = swing * (Math.sin(i / 12 + phase) - Math.sin(phase))
    const noise = ((i * 7919 + Math.round(phase * 13)) % 7) - 3
    const sgv = Math.max(45, Math.round(current + wave + (i === 0 ? 0 : noise)))
    return { date: newest - i * READING_MS, sgv, direction }
  })
}

const AUTH = JSON.stringify({
  state: { token: 't', accountId: 'a', country: 'global', language: 'en', resultUnit: 'mg/dL', showForecast: true, showForecastCone: true },
  version: 0,
})

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(1500) // let charts and transitions settle
  await page.screenshot({ path: path.join(OUT, `${name}.png`), scale: 'css', fullPage: true })
  console.log(`saved ${name}.png`)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const sites = await Promise.all(PATIENTS.map(() => startMockNightscout(SECRET)))
  sites.forEach((site, i) => site.state.entries.push(...trace(PATIENTS[i])))
  const { app, cleanup } = await launchApp()
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    const resize = (index: number, width: number, height: number) =>
      app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[size.index].setSize(size.width, size.height), { index, width, height })
    await resize(0, 1000, 680)

    await win.getByPlaceholder('Username').waitFor({ timeout: 20_000 })
    await shot(win, 'login')

    await win.evaluate((auth) => {
      localStorage.setItem('auth-storage', auth)
      localStorage.setItem('vite-ui-theme', 'light')
    }, AUTH)
    await win.reload()
    await win.getByRole('heading', { name: 'Patients' }).waitFor({ timeout: 20_000 })

    for (const [i, patient] of PATIENTS.entries()) {
      await win.getByLabel('Add patient').click()
      await win.getByLabel('Reading source').selectOption('nightscout')
      await win.getByPlaceholder('https://my-site.example.com').fill(sites[i].url)
      await win.getByPlaceholder('API secret (blank if public)').fill(SECRET)
      await win.getByPlaceholder('Patient name (optional)').fill(patient.name)
      await win.getByRole('button', { name: 'Add', exact: true }).click()
      await win.locator('[data-testid^="patient-card-"]').nth(i).waitFor({ timeout: 30_000 })
    }
    await win.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 20_000 })
    await shot(win, 'dashboard')

    const [settings] = await Promise.all([app.waitForEvent('window'), win.getByLabel('Settings').click()])
    await settings.getByText('System Tray').waitFor({ timeout: 20_000 })
    await shot(settings, 'settings')
    await settings.close()
    await win.locator('[data-testid^="patient-card-"]', { hasText: 'Jordan' }).click()
    await win.getByRole('heading', { name: 'Jordan' }).waitFor()
    await win.getByRole('button', { name: '6 h' }).click()
    await win.getByTestId('patient-graph').waitFor()
    await shot(win, 'patient')
    // The Alarms button opens the patient's alarm settings in their own window.
    const [alarms] = await Promise.all([app.waitForEvent('window'), win.getByRole('button', { name: 'Alarms' }).click()])
    const siteUrl = alarms.getByLabel('Nightscout site URL')
    await siteUrl.waitFor({ timeout: 20_000 })
    await siteUrl.fill('https://nightscout.example.com') // display only: replaces the mock server's local address
    await siteUrl.blur()
    await shot(alarms, 'alarms')
  } finally {
    await cleanup()
    await Promise.all(sites.map((site) => site.stop()))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
