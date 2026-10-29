import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useAlarmConfig } from '@/hooks/useAlarmConfig';
import { useAuthStore } from '@/stores/auth';
import { fromUnit, toUnit } from '@/lib/glucose';
import type { AlarmConfig } from '../../shared/stores';

const FIELDS = [
  ['urgentLow', 'Urgent low'],
  ['low', 'Low'],
  ['high', 'High'],
  ['urgentHigh', 'Urgent high'],
] as const;

type Draft = {
  enabled: boolean;
  sound: boolean;
  signalLossMinutes: string;
} & Record<(typeof FIELDS)[number][0], string>;

const toDraft = (config: AlarmConfig, unit: string): Draft => ({
  enabled: config.enabled,
  sound: config.sound,
  urgentLow: String(toUnit(config.urgentLow, unit)),
  low: String(toUnit(config.low, unit)),
  high: String(toUnit(config.high, unit)),
  urgentHigh: String(toUnit(config.urgentHigh, unit)),
  signalLossMinutes: String(config.signalLossMinutes),
});

/** Alarm settings for one patient. */
export function PatientAlarms({ patientId }: { patientId: string }) {
  const unit = useAuthStore((s) => s.resultUnit);
  const { config, update } = useAlarmConfig(patientId);

  // Edits stay in the draft until Save is pressed.
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const current = config ? toDraft(config, unit) : undefined;
  useEffect(() => {
    setDraft(current);
  }, [JSON.stringify(current)]);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(current);
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => d && { ...d, ...patch });
    setError(undefined);
    setSaved(false);
  };

  const save = async () => {
    if (!config || !draft || !current) return;
    const patch: Partial<AlarmConfig> = {};
    if (draft.enabled !== current.enabled) patch.enabled = draft.enabled;
    if (draft.sound !== current.sound) patch.sound = draft.sound;
    for (const [key, label] of FIELDS) {
      if (draft[key] === current[key]) continue;
      const v = Number(draft[key]);
      if (!draft[key].trim() || !Number.isFinite(v) || v <= 0) return setError(`${label} must be a positive number`);
      patch[key] = fromUnit(v, unit);
    }
    if (draft.signalLossMinutes !== current.signalLossMinutes) {
      const v = Number(draft.signalLossMinutes);
      if (!draft.signalLossMinutes.trim() || !Number.isFinite(v) || v <= 0) return setError('Signal loss must be a positive number of minutes');
      patch.signalLossMinutes = v;
    }
    await update(patch);
    setSaved(true);
  };

  return (
    <div className="space-y-6" data-testid="patient-alarms">
      {!config || !draft ? null : (
        <>
          <div className="flex justify-between gap-4">
            <p className="text-gray-400">Alarms enabled</p>
            <ToggleSwitch checked={draft.enabled} onChange={(enabled) => edit({ enabled })} />
          </div>
          <div className="flex justify-between gap-4">
            <p className="text-gray-400">Play sound</p>
            <ToggleSwitch checked={draft.sound} onChange={(sound) => edit({ sound })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {FIELDS.map(([key, label]) => (
              <div key={key}>
                <p className="text-foreground/30 text-xs mb-2">
                  {label} ({unit})
                </p>
                <Input
                  type="number"
                  step={unit === 'mmol/L' ? 0.1 : 1}
                  aria-label={label}
                  value={draft[key]}
                  onChange={(e) => edit({ [key]: e.target.value })}
                />
              </div>
            ))}
            <div>
              <p className="text-foreground/30 text-xs mb-2">Signal loss (minutes)</p>
              <Input
                type="number"
                aria-label="Signal loss minutes"
                value={draft.signalLossMinutes}
                onChange={(e) => edit({ signalLossMinutes: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={!dirty}>
              Save
            </Button>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {saved && !dirty && <p className="text-sm text-muted-foreground">Saved</p>}
          </div>
          <Button variant="ghost" onClick={() => window.electron.ipcRenderer.invoke('alarms:reset', patientId)}>
            Reset to sensor defaults
          </Button>
        </>
      )}
    </div>
  );
}
