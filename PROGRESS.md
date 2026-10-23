# LibreLinkWard progress

Plan: `~/.claude/plans/there-is-a-github-magical-fiddle.md`. Repo: github.com/koumoutsas/LibreLinkWard (fork of Crazy-Marvin/LibreLinkUpDesktop), working branch `multi-patient`.
Workflow: commit and push after each finished piece of work; update this file.

## Done
- [x] Step 1: fork, rename (package/productName/appId `io.github.koumoutsas.librelinkward`), NOTICE, CHANGES.md, README disclaimer + acknowledgements, removed Snap/Flathub/Store packaging, baseline build + smoke test green.

- [x] Step 2: `src/shared/linkup/` (typed `LinkUpClient` with regional redirect, 401 re-login, all connections, graphData; `Poller` with per-tick fan-out, rate-limit stop, exponential backoff). 15 tests green. `renderer/lib/linkup.ts` is now a thin adapter. Not yet wired into the main process: that needs credentials in main (safeStorage), done in step 3.

- [x] Step 3: `src/shared/stores/` (zustand vanilla `patientStore`: per-patient latest/12h deduped history/status/lastUpdated; `alarmStore`: per-patient overrides over sensor-target defaults, snooze). Main: `credentialStore.ts` (safeStorage, refuses plaintext), `pollingService.ts` (login check, Poller -> patientStore, halts on auth errors), `pollingHandler.ts` (IPC `linkup:sign-in`, `linkup:get-state`, `alarms:get/set`; pushes `linkup:state`, `alarms:changed`; alarm overrides persisted to `userData/alarms.json`; `logout` signs out). Started in `whenReady`, stopped on `before-quit`. login.tsx now also invokes `linkup:sign-in`. 34 tests green, main bundle builds.

- [x] Step 4 (UI, alarm banner deferred to step 5): renderer consumes `linkup:state` / `alarms:*` IPC (`hooks/usePatients`, `hooks/useAlarmConfig`). Dashboard is a patient card grid (value, trend, level colour from per-patient thresholds, 3h sparkline with hover tooltip, "x min ago", connection-problem flag). `/patients/:id` detail page with Recharts graph (3/6/12h, target band, tooltip value+unit+time). `/settings/patients/:id` per-patient alarm settings (thresholds in the user's unit, stored in mg/dL; signal loss; sound; reset via new `alarms:reset` IPC); `settings/alert` lists patients and no longer has the global threshold override. Pure helpers in `renderer/lib/glucose.ts`. 51 tests green, renderer bundle builds.

- [x] Step 5: `src/shared/alarms/evaluateAlarms.ts` (pure engine: urgent-low/low/high/urgent-high + signal-loss, 5 mg/dL hysteresis, 5 min repeat, acknowledge, escalation re-notifies, snooze suppresses). Main `alarmService.ts` runs it per patient on store changes + 30 s timer (per-patient `resolveAlarmConfig` + snooze), pushes `alarms:active` / `alarms:notify`; IPC `alarms:get-active`, `alarms:acknowledge`, `alarms:snooze`, `alarms:clear-snooze`. Renderer `AlarmBanner` (dashboard + patient page) names the patient with Acknowledge / Snooze 15/30/60m, and on notify reuses `trigger-warning-alerts` (bring to front/flash from `alertStore`) and `AudioManager` sound. 72 tests green, both bundles build.

## Known issues / notes
- Old `useGlucoseAlerts` hook is now dead code (superseded by the alarm engine); `alertStore` still holds the bring-to-front/flash/sound toggles. Snooze applies to all kinds incl. urgent low (no bypass). Alarm sound/flash is triggered by the renderer, so a renderer window must exist (hidden-to-tray is fine). Tray number follows a patient only when exactly one is shared. Overlay/compact window mode UI was dropped from the dashboard.
- Settings labels added in step 4 are hardcoded English (not in i18n files yet).
- Renderer still holds its own auth token (login gating) alongside main's credentials.
- `npm install --legacy-peer-deps` required.
- ts-jest runs transpile-only; `npx tsc --noEmit` shows 7 errors in `src/` (isPrimary on BrowserWindow in main.ts/logoutHandler.ts/refreshHandler.ts, toggle-switch.tsx, trayManager.ts:334). Fix in step 8 (add typecheck to CI).
- Alarm snoozes are in-memory only (not persisted) by design.
- Patient history is in-memory only; rebuilt from graphData on each poll.
- README badges still point at upstream (CI/last commit/etc.); update when CI exists.

## Next
- [ ] 6 Nightscout, 7 tests, 8 CI/CD, 9 docs
