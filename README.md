[![CI](https://github.com/koumoutsas/LibreLinkWard/actions/workflows/ci.yml/badge.svg)](https://github.com/koumoutsas/LibreLinkWard/actions/workflows/ci.yml)
![License](https://img.shields.io/github/license/koumoutsas/LibreLinkWard.svg)
[![Figma Mockups](https://img.shields.io/badge/Figma-black?logo=figma)](https://www.figma.com/file/GpKMB4Qnp2FWi4A9gM19Gf/Untitled?type=design&node-id=0%3A1&mode=design&t=0qRXeUdC0lafjaKt-1)
[![Last commit](https://img.shields.io/github/last-commit/koumoutsas/LibreLinkWard.svg?style=flat)](https://github.com/koumoutsas/LibreLinkWard/commits)
[![Releases](https://img.shields.io/github/downloads/koumoutsas/LibreLinkWard/total.svg?style=flat)](https://github.com/koumoutsas/LibreLinkWard/releases)
[![Issues](https://img.shields.io/github/issues/koumoutsas/LibreLinkWard.svg?style=flat)](https://github.com/koumoutsas/LibreLinkWard/issues)
[![Electron](https://img.shields.io/badge/-Electron-blue?logo=electron&?labelColor=white&link=https%3A%2F%2Fwww.electronjs.org%2F)](https://www.electronjs.org/)

# LibreLinkWard
LibreLinkWard is a desktop application for monitoring blood glucose from [LibreLinkUp](https://librelinkup.com/), aimed at nurses and carers who follow **multiple patients** at once.

It is a fork of [LibreLinkUpDesktop](https://github.com/Crazy-Marvin/LibreLinkUpDesktop) by Crazy Marvin & Contributors (Apache-2.0). See [Acknowledgements](#acknowledgements) and [CHANGES.md](CHANGES.md).

> **Disclaimer:** LibreLinkWard is not a medical device and is not affiliated with Abbott. It relies on an unofficial API and must not be the sole means of monitoring a patient.

Under the hood, [Electron](https://www.electronjs.org/) is used with [TypeScript](https://www.typescriptlang.org/) and [React](https://react.dev/).
As there is no official API from [Abbott](https://www.freestyle.abbott/), the LibreLinkUp API is used directly, following the approach of the [client from DiaKEM](https://github.com/DiaKEM/libre-link-up-api-client).

## Features
- Monitor **several patients** at once: one card per LibreLinkUp connection with value, trend, 3 h sparkline and "x min ago".
- Patient page with a 3/6/12 h graph, target band and hover tooltip (value, unit, time).
- **Per-patient alarms**: urgent low / low / high / urgent high and signal loss, with acknowledge and snooze. The banner names the patient.
- Optional, per-patient **Nightscout upload** (off by default).
- Credentials stored with the OS keychain (Electron `safeStorage`); no tracking. See [PRIVACY.md](PRIVACY.md).
- mg/dL and mmol/L, dark mode.

## Setup
1. Install LibreLinkWard from [GitHub Releases](https://github.com/koumoutsas/LibreLinkWard/releases). Builds are **unsigned**, so macOS asks you to allow it in _System Settings > Privacy & Security_ and Windows SmartScreen shows a warning.
2. Sign in with a patient's LibreLinkUp credentials. The operator needs no Libre account of their own.
3. Press **Add patient** on the dashboard and enter the next patient's credentials. Each login becomes its own view, stacked vertically below the others. Remove a view with **Remove**.

Each login is verified before it is saved, and all logins are polled once a minute. Adding the same credentials twice creates two independent views (useful for testing); each view has its own alarms and Nightscout settings, so a real deployment should not add a patient twice. A login that is a follower account with several shared patients shows all of them in its view.

## Usage
- **Dashboard**: one view per login, each with the patient's value, trend and a 6 h graph (hover for value and time). Click a view for the patient page (3/6/12 h graph, alarms). Views are coloured by that patient's own thresholds.
- **Settings > Alerts** lists patients; open one to edit its alarms.
- **Logout** (Settings > Account) removes all logins.

### Alarms
Each patient has their own configuration. Defaults: urgent low 55, low = sensor target low (70), high = sensor target high (180), urgent high 250 mg/dL; signal loss after 20 min. Thresholds are shown in your chosen unit.

- Hysteresis of 5 mg/dL before an alarm clears; it repeats every 5 min until acknowledged; moving to a more severe level notifies again.
- **Acknowledge** silences the current alarm. **Snooze** (15/30/60 min) suppresses all alarms for that patient, **including urgent low**.
- Sound and window flash are triggered by the app window, so keep the app running (hidden to the tray is fine). Alarm snoozes are not kept across restarts.

### Nightscout (optional)
In a patient's settings, enable Nightscout and enter the URL, API secret and a device name, then press _Test_. New readings are uploaded via API v1 (`POST /api/v1/entries`), resuming after Nightscout's newest entry so nothing is duplicated, and retried with backoff on failure. Only readings still in the app's 12 h memory can be uploaded, so an outage longer than 12 h loses data. The secret is stored encrypted and never shown again.

## Build
Requires Node 22.15+. `npm install --legacy-peer-deps`

| Command | Purpose |
|---|---|
| `npm start` | development |
| `npm test` / `npm run test:coverage` | unit + integration tests (coverage gate) |
| `npm run typecheck` | TypeScript check |
| `npm run package:dir` then `npm run test:e2e` | packaged app + Playwright smoke test |
| `npm run package` | installer for the current OS |

| OS | Artifacts | CI |
|---|---|---|
| macOS | dmg (arm64, x64) | blocking |
| Windows | nsis `-setup.exe`, msi | blocking |
| Linux | AppImage, deb | best effort (e2e non-blocking) |

CI (`.github/workflows/ci.yml`) runs typecheck, tests with coverage and a packaged-app smoke test on all three systems. Pushing a tag runs `build-and-release.yml`. macOS notarization only runs if the `APPLE_ID` / `APPLE_ID_PASS` secrets are set; there is no code signing for macOS or Windows yet.

# Screenshots

Login | Main Screen | Settings
------------ | ------------- | -------------
![LibreLinkUpDesktop Login Screen](https://github.com/user-attachments/assets/95ee1407-acfa-40bf-bc11-9babc1e2243c) | ![LibreLinkUpDesktop Main Screen](https://github.com/user-attachments/assets/4cc57b56-a282-4341-87ec-436569056b92) | ![LibreLinkUpDesktop Settings Screen](https://github.com/user-attachments/assets/88dd4fec-7e78-4af0-ba1a-b13c56c1aef2)

# Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Privacy: [PRIVACY.md](PRIVACY.md).

# Acknowledgements

LibreLinkWard is built on [LibreLinkUpDesktop](https://github.com/Crazy-Marvin/LibreLinkUpDesktop), created by Crazy Marvin and contributors, especially Yuran Fernando. Thank you for the free software this work stands on.

# License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
