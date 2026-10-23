# Contributing to LibreLinkWard

Contributions are welcome and are licensed under [Apache-2.0](LICENSE), like the rest of the project.

1. Open an issue for anything non-trivial before starting.
2. Fork, branch from `multi-patient` (or the current default branch), and open a pull request.
3. `npm install --legacy-peer-deps`

## Before you push
- `npm run typecheck`
- `npm run test:coverage` must pass (global gate 90/80/90/90 over shared code, main logic and glucose helpers).
- Add or update tests with your change. Logic lives in `src/shared` and `src/main` as pure, injectable modules; integration tests in `src/__tests__` use local mock LibreLinkUp and Nightscout servers (`helpers/mockServers.ts`), never the real services.
- `npm run package:dir && npm run test:e2e` for the packaged-app smoke test (needs the Electron binary: `node node_modules/electron/install.js`).
- `npm run lint` (with `ESLINT_USE_FLAT_CONFIG=false`) is advisory in CI and has inherited errors; don't add new ones.

## Layout
- `src/shared/linkup` API client and poller; `src/shared/stores` patient and alarm stores; `src/shared/alarms` alarm engine.
- `src/main` Electron main: credentials, polling service, alarm service, Nightscout uploader, IPC.
- `src/renderer` React UI.

## Attribution
This is a fork of [LibreLinkUpDesktop](https://github.com/Crazy-Marvin/LibreLinkUpDesktop). Keep `NOTICE` and record significant changes in `CHANGES.md`.

## Safety
LibreLinkWard is not a medical device. Changes to alarm behaviour need tests covering the new behaviour.
