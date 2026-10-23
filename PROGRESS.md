# LibreLinkWard progress

Plan: `~/.claude/plans/there-is-a-github-magical-fiddle.md`. Repo: github.com/koumoutsas/LibreLinkWard (fork of Crazy-Marvin/LibreLinkUpDesktop), working branch `multi-patient`.
Workflow: commit and push after each finished piece of work; update this file.

## Done
- [x] Step 1: fork, rename (package/productName/appId `io.github.koumoutsas.librelinkward`), NOTICE, CHANGES.md, README disclaimer + acknowledgements, removed Snap/Flathub/Store packaging, baseline build + smoke test green.

- [x] Step 2: `src/shared/linkup/` (typed `LinkUpClient` with regional redirect, 401 re-login, all connections, graphData; `Poller` with per-tick fan-out, rate-limit stop, exponential backoff). 15 tests green. `renderer/lib/linkup.ts` is now a thin adapter. Not yet wired into the main process: that needs credentials in main (safeStorage), done in step 3.

- [x] Step 3: `src/shared/stores/` (zustand vanilla `patientStore`: per-patient latest/12h deduped history/status/lastUpdated; `alarmStore`: per-patient overrides over sensor-target defaults, snooze). Main: `credentialStore.ts` (safeStorage, refuses plaintext), `pollingService.ts` (login check, Poller -> patientStore, halts on auth errors), `pollingHandler.ts` (IPC `linkup:sign-in`, `linkup:get-state`, `alarms:get/set`; pushes `linkup:state`, `alarms:changed`; alarm overrides persisted to `userData/alarms.json`; `logout` signs out). Started in `whenReady`, stopped on `before-quit`. login.tsx now also invokes `linkup:sign-in`. 34 tests green, main bundle builds.

## Known issues / notes
- `npm install --legacy-peer-deps` required.
- ts-jest runs transpile-only; `npx tsc --noEmit` shows 7 errors in `src/` (isPrimary on BrowserWindow in main.ts/logoutHandler.ts/refreshHandler.ts, toggle-switch.tsx, trayManager.ts:334). Fix in step 8 (add typecheck to CI).
- Alarm snoozes are in-memory only (not persisted) by design.
- Patient history is in-memory only; rebuilt from graphData on each poll.
- README badges still point at upstream (CI/last commit/etc.); update when CI exists.

## Next
- [ ] Step 4 UI/graph (renderer should consume `linkup:state` / `alarms:*` IPC; renderer still keeps its own session in auth store + uses old single-patient dashboard until then), 5 alarm engine (should read `alarmStore` + `isSnoozed`; hook into patientStore subscription in pollingHandler), 6 Nightscout, 7 tests, 8 CI/CD, 9 docs
