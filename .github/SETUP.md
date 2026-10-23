# LibreLinkUpDesktop Setup

## Building the application.

Install Node.js 20 on your machine and go to the project root and run following command:

```bash
npm install --legacy-peer-deps
```

In order to generate the executables run following command:

```bash
npm run package
```

To generate executables for all platforms run this:

```bash
npm run package-all
```

Note: Executables can be found in `release/build` folder.

A [release](https://github.com/Crazy-Marvin/LibreLinkUpDesktop/releases)
should include those executables:

- AppImage
- snap
- deb
- MSI
- EXE
- portable
- pkg

The ```version``` in the ```package.json```, and ```/release/app/package.json``` need to be
increased ([example PR](https://github.com/Crazy-Marvin/LibreLinkUpDesktop/pull/523/changes)) following the rules of [Semantic Versioning](https://semver.org/).

## Customizing the application

- Localization is located on `src/renderer/i18n` folder.
- App configuration can be found on `src/renderer/config` folder

## Releases

Push a version tag; `build-and-release.yml` publishes installers to GitHub Releases. No app store distribution is maintained.
