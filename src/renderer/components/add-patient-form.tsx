import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Input } from '@/components/ui/input';
import { countries } from '@/config/app';

type Props = { onDone: () => void };

/** Adds another view: a LibreLinkUp login (e.g. the patient's own) or a Nightscout site. */
export function AddPatientForm({ onDone }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('global');
  const [source, setSource] = useState<'linkup' | 'nightscout'>('linkup');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res =
        source === 'nightscout'
          ? await window.electron.ipcRenderer.invoke('linkup:add-nightscout', {
              url: url.trim(),
              apiSecret: secret,
              name: name.trim(),
            })
          : await window.electron.ipcRenderer.invoke('linkup:sign-in', {
              username: username.trim(),
              password,
              country,
            });
      if (res?.ok) {
        toast.success('Patient added');
        onDone();
      } else {
        toast.error(
          res?.status === 429
            ? 'Too many attempts, try again later.'
            : `${source === 'nightscout' ? 'Connection' : 'Sign-in'} failed: ${res?.error ?? 'unknown error'}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} data-testid="add-patient-form" className="mb-4 grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
      <select
        aria-label="Reading source"
        value={source}
        onChange={(e) => setSource(e.target.value as 'linkup' | 'nightscout')}
        className="h-10 rounded-md border bg-background px-3 text-sm sm:col-span-4"
      >
        <option value="linkup">LibreLinkUp login</option>
        <option value="nightscout">Nightscout site</option>
      </select>
      {source === 'nightscout' ? (
        <>
          <Input placeholder="https://my-site.example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <Input
            type="password"
            placeholder="API secret (blank if public)"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <Input placeholder="Patient name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        </>
      ) : (
        <>
          <Input placeholder="Patient username (email)" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <PasswordInput placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <select
            aria-label="Country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            {countries.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || (source === 'nightscout' ? !url : !username || !password)}>
          {busy ? 'Checking…' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
