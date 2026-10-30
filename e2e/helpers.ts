import { _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const BUILD = path.join(__dirname, '..', 'release', 'build')

/** Packaged app from `npm run package:dir` (the unpackaged app looks for a dev-only preload). */
export function findExecutable(): string {
  if (process.env.E2E_EXECUTABLE) return process.env.E2E_EXECUTABLE
  const candidates: string[] = []
  for (const dir of fs.existsSync(BUILD) ? fs.readdirSync(BUILD) : []) {
    const full = path.join(BUILD, dir)
    if (dir.startsWith('mac')) {
      for (const app of fs.readdirSync(full).filter((f) => f.endsWith('.app'))) {
        const macos = path.join(full, app, 'Contents', 'MacOS')
        candidates.push(...fs.readdirSync(macos).map((f) => path.join(macos, f)))
      }
    } else if (dir.endsWith('-unpacked') && dir.startsWith(process.platform === 'win32' ? 'win' : 'linux') && process.platform !== 'darwin') {
      candidates.push(
        ...fs
          .readdirSync(full)
          .filter((f) => (process.platform === 'win32' ? /\.exe$/.test(f) && !/uninstall/i.test(f) : f === 'librelinkward'))
          .map((f) => path.join(full, f)),
      )
    }
  }
  if (candidates.length === 0) throw new Error('No packaged app found; run `npm run package:dir` first')
  // Several builds can sit side by side (e.g. x64 and arm64); use the newest.
  return candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
}

/** Starts the packaged app with a throwaway profile; `cleanup` closes it and removes the profile. */
export async function launchApp(): Promise<{ app: ElectronApplication; cleanup: () => Promise<void> }> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llw-e2e-'))
  const app = await electron.launch({
    executablePath: findExecutable(),
    args: [`--user-data-dir=${userData}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  })
  return {
    app,
    cleanup: async () => {
      await app.close()
      fs.rmSync(userData, { recursive: true, force: true })
    },
  }
}
