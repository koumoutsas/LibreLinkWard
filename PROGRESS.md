# LibreLinkWard progress

Plan: `~/.claude/plans/there-is-a-github-magical-fiddle.md`. Repo: github.com/koumoutsas/LibreLinkWard (fork of Crazy-Marvin/LibreLinkUpDesktop), working branch `multi-patient`.
Workflow: commit and push after each finished piece of work; update this file.

## Done
- [x] Step 1: fork, rename (package/productName/appId `io.github.koumoutsas.librelinkward`), NOTICE, CHANGES.md, README disclaimer + acknowledgements, removed Snap/Flathub/Store packaging, baseline build + smoke test green.

- [x] Step 2: `src/shared/linkup/` (typed `LinkUpClient` with regional redirect, 401 re-login, all connections, graphData; `Poller` with per-tick fan-out, rate-limit stop, exponential backoff). 15 tests green. `renderer/lib/linkup.ts` is now a thin adapter. Not yet wired into the main process: that needs credentials in main (safeStorage), done in step 3.

## Known issues / notes
- `npm install --legacy-peer-deps` required.
- ts-jest runs transpile-only; `npx tsc --noEmit` shows 7 errors in `src/` (isPrimary on BrowserWindow in main.ts/logoutHandler.ts/refreshHandler.ts, toggle-switch.tsx, trayManager.ts:334). Fix in step 8 (add typecheck to CI).
- README badges still point at upstream (CI/last commit/etc.); update when CI exists.

## Next
- [ ] Step 3 stores + safeStorage credentials + start Poller in main, 4 UI/graph, 5 alarm engine, 6 Nightscout, 7 tests, 8 CI/CD, 9 docs
