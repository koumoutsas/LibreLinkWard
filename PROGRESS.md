# LibreLinkWard progress

Plan: `~/.claude/plans/there-is-a-github-magical-fiddle.md`. Repo: github.com/koumoutsas/LibreLinkWard (fork of Crazy-Marvin/LibreLinkUpDesktop), working branch `multi-patient`.
Workflow: commit and push after each finished piece of work; update this file.

## Done
- [x] Step 1: fork, rename (package/productName/appId `io.github.koumoutsas.librelinkward`), NOTICE, CHANGES.md, README disclaimer + acknowledgements, removed Snap/Flathub/Store packaging, baseline build + smoke test green.

## Known issues / notes
- `npm install --legacy-peer-deps` required.
- ts-jest runs transpile-only; `npx tsc --noEmit` shows 9 errors in `src/` (isPrimary on BrowserWindow in main.ts/logoutHandler.ts/refreshHandler.ts, toggle-switch.tsx, trayManager.ts:334, settings/account.tsx). Fix in step 8 (add typecheck to CI).
- `src/renderer/lib/utils.ts` has a temporary `as any` on `getCGMData` (wrong declared return type); remove in step 2.
- README badges still point at upstream (CI/last commit/etc.); update when CI exists.

## Next
- [ ] Step 2: API layer refactor into `src/shared/linkup/` (all connections, graphData, 401 re-login, main-process polling)
- [ ] Step 3 stores, 4 UI/graph, 5 alarm engine, 6 Nightscout, 7 tests, 8 CI/CD, 9 docs
