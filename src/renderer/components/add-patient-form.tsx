import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { countries } from '@/config/app';

type Props = { onDone: () => void };

/** Adds another LibreLinkUp login (e.g. the patient's own) as a new view. */
export function AddPatientForm({ onDone }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('global');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await window.electron.ipcRenderer.invoke('linkup:sign-in', {
        username: username.trim(),
        password,
        country,
      });
      if (res?.ok) {
        toast.success('Patient added');
        onDone();
      } else {
        toast.error(res?.status === 429 ? 'Too many attempts, try again later.' : `Sign-in failed: ${res?.error ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} data-testid="add-patient-form" className="mb-4 grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
      <Input placeholder="Patient username (email)" value={username} onChange={(e) => setUsername(e.target.value)} required />
      <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !username || !password}>
          {busy ? 'Checking…' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
