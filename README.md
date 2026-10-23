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

#### Features of LibreLinkUpDesktop:
- Show blood glucose level on your desktop in a little window
- No tracking
- Dark Mode
- Libre software
- That's it. 🩸

### Instructions:
  - As sharing person, open your [Libre smartphone app](https://play.google.com/store/apps/details?id=com.freestylelibre3.app.de), go to _Connected Apps_, click on _Manage_ next to LibreLinkUp, click on _Add connection_ and input the details for the account you wish to use with LibreLinkUpDesktop.
  - Save those credentials inside your password manager. You may use them for yourself or you may share them with someone.
  - Start LibreLinkUpDesktop and enter those credentials.
  - That's it. ☺️
 
  Let me know about any issues by opening a new [issue on GitHub](https://github.com/Crazy-Marvin/LibreLinkUpDesktop/issues) or commenting on an existing issue if there is one already.

  Download the installers for macOS, Windows and Linux from [GitHub Releases](https://github.com/koumoutsas/LibreLinkWard/releases) and run them directly; no app store builds exist.

# Screenshots

Login | Main Screen | Settings
------------ | ------------- | -------------
![LibreLinkUpDesktop Login Screen](https://github.com/user-attachments/assets/95ee1407-acfa-40bf-bc11-9babc1e2243c) | ![LibreLinkUpDesktop Main Screen](https://github.com/user-attachments/assets/4cc57b56-a282-4341-87ec-436569056b92) | ![LibreLinkUpDesktop Settings Screen](https://github.com/user-attachments/assets/88dd4fec-7e78-4af0-ba1a-b13c56c1aef2)

# Contributing

The ```development``` or a feature branch is used while developing the code, and pushed into the master branch ```trunk``` afterwards for releases.
PRs to the ```trunk``` need at least one approving review before getting merged.

Help translate the app at [Hosted Weblate](https://hosted.weblate.org/engage/librelinkupdesktop/).

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.

Check out the [contribution guidelines](https://github.com/Crazy-Marvin/LibreLinkUpDesktop/blob/trunk/.github/CONTRIBUTING.md) for details please.

# Acknowledgements

LibreLinkWard is built on [LibreLinkUpDesktop](https://github.com/Crazy-Marvin/LibreLinkUpDesktop), created by Crazy Marvin and contributors, especially Yuran Fernando. Thank you for the free software this work stands on.

# License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
