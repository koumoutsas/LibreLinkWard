import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { EyeClosedIcon, EyeOpenIcon } from '@radix-ui/react-icons';

type NightscoutState = {
  enabled: boolean;
  url: string;
  deviceName: string;
  hasSecret: boolean;
  status: { lastUploaded?: number; lastError?: string };
};

const ipc = () => window.electron.ipcRenderer;

/** Optional per-patient upload of readings to the user's own Nightscout site. */
export function NightscoutSettings({ patientId }: { patientId: string }) {
  const [state, setState] = useState<NightscoutState>();
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [device, setDevice] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  // The stored secret, once revealed, so showing it does not count as an edit.
  const [revealed, setRevealed] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string>();

  const refresh = useCallback(async () => {
    const s: NightscoutState = await ipc().invoke('nightscout:get', patientId);
    setState(s);
    setUrl(s.url);
    setDevice(s.deviceName);
  }, [patientId]);

  useEffect(() => {
    refresh();
    return ipc().on('nightscout:changed', () => {
      ipc()
        .invoke('nightscout:get', patientId)
        .then((s: NightscoutState) => setState(s));
    });
  }, [patientId, refresh]);

  if (!state) return null;

  const save = async (patch: Record<string, unknown>) => {
    await ipc().invoke('nightscout:set', patientId, patch);
    await refresh();
  };

  const dirty = url !== state.url || device !== state.deviceName || (secret !== '' && secret !== revealed);

  // Edits stay in the form until Save is pressed; a blank secret keeps the stored one.
  const saveAll = async () => {
    await save({ url, deviceName: device, ...(secret && { apiSecret: secret }) });
    setSecret('');
    setRevealed(undefined);
    setShowSecret(false);
    setSaved(true);
  };

  const toggleSecret = async () => {
    if (showSecret) {
      if (secret === revealed) setSecret('');
      setShowSecret(false);
      return;
    }
    if (secret === '' && state.hasSecret) {
      const stored: string = await ipc().invoke('nightscout:reveal-secret', patientId);
      setRevealed(stored);
      setSecret(stored);
    }
    setShowSecret(true);
  };

  const test = async () => {
    setTestResult('Testing…');
    const r = await ipc().invoke('nightscout:test', patientId, { url, apiSecret: secret });
    setTestResult(r.ok ? 'Connection OK' : `Failed: ${r.error}`);
  };

  return (
    <div className="space-y-4 border-t border-border pt-6" data-testid="nightscout-settings">
      <h3 className="font-semibold">Nightscout upload (optional)</h3>
      <p className="text-xs text-muted-foreground">
        Sends this patient&apos;s readings to your own Nightscout site. Off by default; nothing
        leaves this computer unless you enable it.
      </p>
      <div className="flex justify-between gap-4">
        <p className="text-gray-400">Upload to Nightscout</p>
        <ToggleSwitch
          checked={state.enabled}
          onChange={(enabled) => save({ enabled, url, deviceName: device, apiSecret: secret })}
        />
      </div>
      <div className="space-y-3">
        <div>
          <p className="text-foreground/30 text-xs mb-2">Site URL</p>
          <Input
            aria-label="Nightscout URL"
            placeholder="https://my-site.example.com"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div>
          <p className="text-foreground/30 text-xs mb-2">API secret</p>
          <div className="flex gap-2">
            <Input
              type={showSecret ? 'text' : 'password'}
              aria-label="Nightscout API secret"
              placeholder={state.hasSecret ? '•••••••• (saved)' : ''}
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setSaved(false);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={showSecret ? 'Hide API secret' : 'Show API secret'}
              onClick={toggleSecret}
            >
              {showSecret ? <EyeClosedIcon /> : <EyeOpenIcon />}
            </Button>
          </div>
        </div>
        <div>
          <p className="text-foreground/30 text-xs mb-2">Device name</p>
          <Input
            aria-label="Nightscout device name"
            value={device}
            onChange={(e) => {
              setDevice(e.target.value);
              setSaved(false);
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Button onClick={saveAll} disabled={!dirty}>
          Save
        </Button>
        {saved && !dirty && <span className="text-xs text-muted-foreground">Saved</span>}
        <Button variant="ghost" onClick={test}>
          Test connection
        </Button>
        {testResult && <span className="text-xs">{testResult}</span>}
      </div>
      {state.status.lastUploaded && (
        <p className="text-xs text-muted-foreground">
          Last reading uploaded: {new Date(state.status.lastUploaded).toLocaleString()}
        </p>
      )}
      {state.status.lastError && (
        <p className="text-xs text-red-500">Upload problem (will retry): {state.status.lastError}</p>
      )}
    </div>
  );
}
