# Privacy

- **No telemetry, analytics or tracking.** LibreLinkWard has no servers of its own.
- **LibreLinkUp**: the app talks directly to Abbott's LibreLinkUp service (`api*.libreview.io`) with your credentials to fetch glucose data for the patients who shared with you. Abbott's privacy policy applies to that traffic.
- **Credentials** of every login you add are encrypted with the OS keychain via Electron `safeStorage`. If encryption is unavailable the app refuses to store them in plaintext.
- **Glucose history** is held in memory only (last 12 h) and rebuilt on each poll. Nothing is written to disk.
- **On disk** (in the app's user-data folder): alarm settings (`alarms.json`) and, if enabled, encrypted Nightscout settings (`nightscout.bin`). Signing out does not delete Nightscout settings. If recording is used: encrypted recording configs (`recording.bin`) and the readings waiting to be sent (`recording-state.json`, plain JSON). Removing a login, or signing out, deletes that login's recording settings and queued readings.
- **Nightscout** (optional, per patient, off by default): when enabled, that patient's readings are sent to the Nightscout URL you entered. Only you decide where that is; make sure you are allowed to share the patient's data there.
- **Data recording** (optional, per patient, off by default): when you paste a recording config and turn recording on, that patient's readings from that moment on are sent to the AWS account of whoever issued the config. That is a deployment you or your organisation runs (see [docs/recording-setup.md](docs/recording-setup.md)), not the LibreLinkWard developers. Turning recording off stops sending and discards readings not yet sent. Readings already stored can only be deleted in that AWS account.
- **Your responsibility**: if you monitor other people, you are responsible for having their consent and for complying with local health-data rules. LibreLinkWard is not a medical device.
