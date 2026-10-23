# Privacy

- **No telemetry, analytics or tracking.** LibreLinkWard has no servers of its own.
- **LibreLinkUp**: the app talks directly to Abbott's LibreLinkUp service (`api*.libreview.io`) with your credentials to fetch glucose data for the patients who shared with you. Abbott's privacy policy applies to that traffic.
- **Credentials** are encrypted with the OS keychain via Electron `safeStorage`. If encryption is unavailable the app refuses to store them in plaintext.
- **Glucose history** is held in memory only (last 12 h) and rebuilt on each poll. Nothing is written to disk.
- **On disk** (in the app's user-data folder): alarm settings (`alarms.json`) and, if enabled, encrypted Nightscout settings (`nightscout.bin`). Signing out does not delete Nightscout settings.
- **Nightscout** (optional, per patient, off by default): when enabled, that patient's readings are sent to the Nightscout URL you entered. Only you decide where that is; make sure you are allowed to share the patient's data there.
- **Your responsibility**: if you monitor other people, you are responsible for having their consent and for complying with local health-data rules. LibreLinkWard is not a medical device.
