import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

type RecordingState = {
  sid?: string;
  enabled: boolean;
  hasBlob: boolean;
  install?: string;
  region?: string;
  stream?: string;
  status: { lastSent?: number; queued: number; lastError?: string; halted?: boolean };
};

const ipc = () => window.electron.ipcRenderer;

/**
 * Per-patient recording of every reading to the deployment's storage (AWS
 * Firehose -> Iceberg). Configured with a pasted config issued for this
 * patient and this computer; off until turned on.
 */
export function PatientRecordingSettings({ patientId }: { patientId: string }) {
  const [state, setState] = useState<RecordingState>();
  const [blob, setBlob] = useState('');
  const [message, setMessage] = useState<string>();
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setState(await ipc().invoke('recording:get', patientId));
  }, [patientId]);

  useEffect(() => {
    refresh();
    return ipc().on('recording:changed', () => {
      refresh();
    });
  }, [refresh]);

  if (!state) return null;

  const copySid = async () => {
    if (!state.sid) return;
    await navigator.clipboard.writeText(state.sid);
    setCopied(true);
  };

  const saveBlob = async () => {
    const r = await ipc().invoke('recording:set-blob', patientId, blob);
    if (r.ok) {
      setBlob('');
      setMessage('Saved. Turn recording on when you are ready.');
    } else {
      setMessage(`Not saved: ${r.error}`);
    }
    await refresh();
  };

  const test = async () => {
    setMessage('Testing…');
    const r = await ipc().invoke('recording:test', patientId);
    setMessage(r.ok ? 'Connection OK' : `Failed: ${r.error}`);
  };

  const clear = async () => {
    await ipc().invoke('recording:clear', patientId);
    setMessage(undefined);
    await refresh();
  };

  const { status } = state;

  return (
    <div className="space-y-4 border-t border-border pt-6" data-testid="recording-settings">
      <h3 className="font-semibold">Data recording (optional)</h3>
      <p className="text-xs text-muted-foreground">
        Keeps every reading of this patient in your deployment&apos;s AWS storage for later
        analysis. Off by default; when turned on, only readings from that moment on are sent.
      </p>
      <div>
        <p className="text-foreground/30 text-xs mb-2">Patient id (give this to whoever runs the deployment)</p>
        <div className="flex items-center gap-2">
          <code className="text-xs break-all" data-testid="recording-sid">
            {state.sid ?? 'unknown'}
          </code>
          <Button variant="ghost" onClick={copySid} disabled={!state.sid}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <div>
        <p className="text-foreground/30 text-xs mb-2">
          {state.hasBlob
            ? `Configured for ${state.install} (${state.stream}, ${state.region}). Paste a new config to replace it.`
            : 'Recording config'}
        </p>
        <div className="flex gap-2">
          <Input
            type="password"
            aria-label="Recording config"
            placeholder="Paste the config issued for this patient and this computer"
            value={blob}
            onChange={(e) => setBlob(e.target.value)}
          />
          <Button onClick={saveBlob} disabled={!blob.trim()}>
            Save
          </Button>
        </div>
      </div>
      {state.hasBlob && (
        <>
          <div className="flex justify-between gap-4">
            <p className="text-gray-400">Record this patient</p>
            <ToggleSwitch
              checked={state.enabled}
              onChange={(enabled) => ipc().invoke('recording:set-enabled', patientId, enabled)}
            />
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={test}>
              Test connection
            </Button>
            <Button variant="ghost" onClick={clear}>
              Remove config
            </Button>
          </div>
        </>
      )}
      {message && <p className="text-xs">{message}</p>}
      {state.enabled && (
        <p className="text-xs text-muted-foreground">
          {status.lastSent ? `Last sent: ${new Date(status.lastSent).toLocaleString()}` : 'Nothing sent yet'}
          {status.queued > 0 && ` · ${status.queued} waiting`}
        </p>
      )}
      {status.lastError && (
        <p className="text-xs text-red-500">
          {status.halted ? 'Recording stopped: ' : 'Recording problem (will retry): '}
          {status.lastError}
        </p>
      )}
    </div>
  );
}
