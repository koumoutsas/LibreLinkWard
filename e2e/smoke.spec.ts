import { _electron as electron, expect, test } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const BUILD = path.join(__dirname, '..', 'release', 'build')

/** Packaged app from `npm run package:dir` (the unpackaged app looks for a dev-only preload). */
function findExecutable(): string {
  if (process.env.E2E_EXECUTABLE) return process.env.E2E_EXECUTABLE
  const candidates: string[] = []
  for (const dir of fs.existsSync(BUILD) ? fs.readdirSync(BUILD) : []) {
    const full = path.join(BUILD, dir)
    if (dir.startsWith('mac')) {
      for (const app of fs.readdirSync(full).filter((f) => f.endsWith('.app'))) {
        const macos = path.join(full, app, 'Contents', 'MacOS')
        candidates.push(...fs.readdirSync(macos).map((f) => path.join(macos, f)))
      }
    } else if (dir.endsWith('-unpacked')) {
      candidates.push(
        ...fs
          .readdirSync(full)
          .filter((f) => (process.platform === 'win32' ? /\.exe$/.test(f) && !/uninstall/i.test(f) : f === 'librelinkward'))
          .map((f) => path.join(full, f)),
      )
    }
  }
  if (candidates.length === 0) throw new Error('No packaged app found; run `npm run package:dir` first')
  return candidates[0]
}

test('app launches and shows the login screen when signed out', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llw-e2e-'))
  const app = await electron.launch({
    executablePath: findExecutable(),
    args: [`--user-data-dir=${userData}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.locator('input[type="password"]')).toBeVisible({ timeout: 20_000 })
    await expect(window.locator('button[type="submit"]')).toBeVisible()
  } finally {
    await app.close()
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
