# LibreLinkWard progress

Plan: `~/.claude/plans/there-is-a-github-magical-fiddle.md`. Repo: github.com/koumoutsas/LibreLinkWard (fork of Crazy-Marvin/LibreLinkUpDesktop), working branch `multi-patient`.
Workflow: commit and push after each finished piece of work; update this file.

## Done
- [x] Step 1: fork, rename (package/productName/appId `io.github.koumoutsas.librelinkward`), NOTICE, CHANGES.md, README disclaimer + acknowledgements, removed Snap/Flathub/Store packaging, baseline build + smoke test green.

- [x] Step 2: `src/shared/linkup/` (typed `LinkUpClient` with regional redirect, 401 re-login, all connections, graphData; `Poller` with per-tick fan-out, rate-limit stop, exponential backoff). 15 tests green. `renderer/lib/linkup.ts` is now a thin adapter. Not yet wired into the main process: that needs credentials in main (safeStorage), done in step 3.

- [x] Step 3: `src/shared/stores/` (zustand vanilla `patientStore`: per-patient latest/12h deduped history/status/lastUpdated; `alarmStore`: per-patient overrides over sensor-target defaults, snooze). Main: `credentialStore.ts` (safeStorage, refuses plaintext), `pollingService.ts` (login check, Poller -> patientStore, halts on auth errors), `pollingHandler.ts` (IPC `linkup:sign-in`, `linkup:get-state`, `alarms:get/set`; pushes `linkup:state`, `alarms:changed`; alarm overrides persisted to `userData/alarms.json`; `logout` signs out). Started in `whenReady`, stopped on `before-quit`. login.tsx now also invokes `linkup:sign-in`. 34 tests green, main bundle builds.

- [x] Step 4 (UI, alarm banner deferred to step 5): renderer consumes `linkup:state` / `alarms:*` IPC (`hooks/usePatients`, `hooks/useAlarmConfig`). Dashboard is a patient card grid (value, trend, level colour from per-patient thresholds, 3h sparkline with hover tooltip, "x min ago", connection-problem flag). `/patients/:id` detail page with Recharts graph (3/6/12h, target band, tooltip value+unit+time). `/settings/patients/:id` per-patient alarm settings (thresholds in the user's unit, stored in mg/dL; signal loss; sound; reset via new `alarms:reset` IPC); `settings/alert` lists patients and no longer has the global threshold override. Pure helpers in `renderer/lib/glucose.ts`. 51 tests green, renderer bundle builds.

- [x] Step 5: `src/shared/alarms/evaluateAlarms.ts` (pure engine: urgent-low/low/high/urgent-high + signal-loss, 5 mg/dL hysteresis, 5 min repeat, acknowledge, escalation re-notifies, snooze suppresses). Main `alarmService.ts` runs it per patient on store changes + 30 s timer (per-patient `resolveAlarmConfig` + snooze), pushes `alarms:active` / `alarms:notify`; IPC `alarms:get-active`, `alarms:acknowledge`, `alarms:snooze`, `alarms:clear-snooze`. Renderer `AlarmBanner` (dashboard + patient page) names the patient with Acknowledge / Snooze 15/30/60m, and on notify reuses `trigger-warning-alerts` (bring to front/flash from `alertStore`) and `AudioManager` sound. 72 tests green, both bundles build.

- [x] Step 6: `src/main/nightscout/` (`payload.ts` sgv entry + SHA1 api-secret + trend mapping; `client.ts` API v1 test/latest/upload with injectable http; `configStore.ts` per-patient config encrypted via safeStorage, `nightscout.bin`; `uploader.ts` watches patientStore, resumes after Nightscout's newest entry (dedupe), serialises per patient, exponential backoff retry from the same watermark, re-syncs when URL/secret change). IPC `nightscout:get` (secret never returned, only `hasSecret`), `nightscout:set`, `nightscout:test`; push `nightscout:changed`. UI: `NightscoutSettings` card on the per-patient settings page (off by default, test button, last upload / error). 83 tests green, both bundles build.

- [x] Step 7: `src/__tests__/integration.test.ts` drives sign-in -> polling -> patient store -> alarm service -> Nightscout uploader against real HTTP mock servers (`src/__tests__/helpers/mockServers.ts`, plain node `http`, no new deps): 3 patients with per-patient alarms, bad password, 401 re-login, Nightscout dedupe/no duplicates, outage retry, wrong secret. Coverage gate in the jest config (90/80/90/90 global over shared + main logic + glucose helpers; currently ~97/86/97/98), `npm run test:coverage`. RTL tests for the dashboard and graph tooltip already existed (step 4). Playwright e2e smoke (`e2e/smoke.spec.ts`, `npm run package:dir` then `npm run test:e2e`) launches the packaged app and checks the login screen. 89 jest tests + 1 e2e green.

- [x] Step 8 (CI): fixed all 7 `tsc` errors (`src/main/electron-augment.d.ts` for `isPrimary`, typed `this` in main.ts, toggle-switch prop types, tray `destroyed` cast); `npm run typecheck`. New `.github/workflows/ci.yml`: ubuntu/macos/windows matrix running typecheck, lint (advisory), `test:coverage` (gate), then `package:dir` + Playwright smoke (Linux e2e non-blocking, uses xvfb + `--no-sandbox`). Removed Codacy workflow (needs upstream token), README badges now point at this fork. Release workflow (`build-and-release.yml`) already builds dmg arm64/x64, msi/nsis, AppImage/deb on tags; mac notarization hook skips unless `APPLE_ID`/`APPLE_ID_PASS` secrets exist. Not yet verified on GitHub runners: see Known issues.

## Known issues / notes
- Nightscout: uploads only what is in the 12 h in-memory history, so an outage longer than that loses readings; API v3 not evaluated; labels hardcoded English; logout keeps Nightscout configs.
- Old `useGlucoseAlerts` hook is now dead code (superseded by the alarm engine); `alertStore` still holds the bring-to-front/flash/sound toggles. Snooze applies to all kinds incl. urgent low (no bypass). Alarm sound/flash is triggered by the renderer, so a renderer window must exist (hidden-to-tray is fine). Tray number follows a patient only when exactly one is shared. Overlay/compact window mode UI was dropped from the dashboard.
- Settings labels added in step 4 are hardcoded English (not in i18n files yet).
- Renderer still holds its own auth token (login gating) alongside main's credentials.
- `npm install --legacy-peer-deps` required.
- ts-jest runs transpile-only; typecheck is `npm run typecheck` (uses `--skipLibCheck` because nested @types/react duplicates break lib checking).
- `npm run lint` needs `ESLINT_USE_FLAT_CONFIG=false` (ESLint 9 vs eslintrc) and reports ~153 inherited errors; CI lint is advisory.
- Alarm snoozes are in-memory only (not persisted) by design.
- Patient history is in-memory only; rebuilt from graphData on each poll.
- Release workflow has no signing certs for mac/win (unsigned builds); Weblate/Snyk badges removed.

## Next
- [ ] CI run 39967737951 (`gh run list -R koumoutsas/LibreLinkWard`; plain `gh` targets upstream) was still in `npm install` on all 3 OSes after ~20 min: likely `postinstall` (electron-builder install-app-deps / webpack dll build) hanging or very slow. Investigate (cancel, rerun with logs; consider `--ignore-scripts` + explicit electron install for the test job). Then confirm the first CI run is green on GitHub (`gh run list`), fix any OS-specific failures
- [ ] 9 docs (README setup/usage/alarms/Nightscout/build matrix, CONTRIBUTING, privacy note)
- e2e only covers launch + login screen: logging in against the mock needs a base-URL override in `getBaseUrl` (both renderer and main use it), deliberately not added to production code. Unpackaged Electron looks for a dev-only preload, so e2e must use the packaged app. Electron binary may need `node node_modules/electron/install.js` locally.
