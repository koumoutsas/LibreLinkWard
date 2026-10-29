import { useState } from 'react';
import { EyeClosedIcon, EyeOpenIcon } from '@radix-ui/react-icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { AccountInfo } from '@/hooks/usePatients';

const ipc = () => window.electron.ipcRenderer;

/** Connection settings of a Nightscout reader: site URL, API secret and display name. */
export function NightscoutSiteSettings({ account }: { account: AccountInfo }) {
  const [url, setUrl] = useState(account.url ?? '');
  const [name, setName] = useState(account.username);
  const [secret, setSecret] = useState('');
  // The stored secret, once revealed, so showing it does not count as an edit.
  const [revealed, setRevealed] = useState<string>();
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  const dirty =
    url !== (account.url ?? '') || name !== account.username || (secret !== '' && secret !== revealed);

  const edit = (apply: () => void) => {
    apply();
    setMessage(undefined);
  };

  const toggleSecret = async () => {
    if (showSecret) {
      if (secret === revealed) setSecret('');
      setShowSecret(false);
      return;
    }
    if (secret === '' && account.hasSecret) {
      const stored: string = await ipc().invoke('linkup:reveal-nightscout-secret', account.id);
      setRevealed(stored);
      setSecret(stored);
    }
    setShowSecret(true);
  };

  const save = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await ipc().invoke('linkup:update-nightscout', account.id, {
        url: url.trim(),
        name: name.trim(),
        apiSecret: secret,
      });
      if (res?.ok) {
        setSecret('');
        setRevealed(undefined);
        setShowSecret(false);
        setMessage({ ok: true, text: 'Saved' });
      } else {
        setMessage({ ok: false, text: `Connection failed: ${res?.error ?? 'unknown error'}` });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="nightscout-site-settings">
      <div>
        <p className="text-foreground/30 text-xs mb-2">Site URL</p>
        <Input
          aria-label="Nightscout site URL"
          placeholder="https://my-site.example.com"
          value={url}
          onChange={(e) => edit(() => setUrl(e.target.value))}
        />
      </div>
      <div>
        <p className="text-foreground/30 text-xs mb-2">API secret (blank if public)</p>
        <div className="flex gap-2">
          <Input
            type={showSecret ? 'text' : 'password'}
            aria-label="Nightscout site API secret"
            placeholder={account.hasSecret ? '•••••••• (saved)' : ''}
            value={secret}
            onChange={(e) => edit(() => setSecret(e.target.value))}
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
        <p className="text-foreground/30 text-xs mb-2">Patient name</p>
        <Input
          aria-label="Nightscout patient name"
          value={name}
          onChange={(e) => edit(() => setName(e.target.value))}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || busy || !url.trim()}>
          {busy ? 'Checking…' : 'Save'}
        </Button>
        {message && (
          <span className={message.ok ? 'text-xs text-muted-foreground' : 'text-xs text-red-500'}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
