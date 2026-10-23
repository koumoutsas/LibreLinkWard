# Changes from LibreLinkUpDesktop

LibreLinkWard is a fork of [LibreLinkUpDesktop](https://github.com/Crazy-Marvin/LibreLinkUpDesktop)
(Apache-2.0), as required by Apache License 2.0 section 4(b). Significant modifications:

- Renamed the application, package and app id to LibreLinkWard.
- Multi-patient monitoring: all LibreLinkUp connections polled from the main process, with patient cards and per-patient graphs.
- Per-patient alarm engine (thresholds, hysteresis, snooze, signal loss) replacing the single global alert.
- Credentials stored via Electron `safeStorage`.
- Optional per-patient Nightscout uploader.
- Unit, integration and e2e tests; CI on macOS/Windows/Linux; removed Snap/Flathub/Store packaging.
- Docs: README, CONTRIBUTING, PRIVACY.

Per-file history is available in the git log.
