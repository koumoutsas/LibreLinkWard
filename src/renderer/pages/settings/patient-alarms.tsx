import { useParams } from 'react-router-dom';
import SettingsLayout from '@/layouts/settings-layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { usePatients } from '@/hooks/usePatients';
import { useAlarmConfig } from '@/hooks/useAlarmConfig';
import { useAuthStore } from '@/stores/auth';
import { NightscoutSettings } from '@/components/nightscout-settings';
import { fromUnit, toUnit } from '@/lib/glucose';

const FIELDS = [
  ['urgentLow', 'Urgent low'],
  ['low', 'Low'],
  ['high', 'High'],
  ['urgentHigh', 'Urgent high'],
] as const;

/** Alarm settings for one patient, or a patient picker when none is chosen. */
export default function SettingsPatientAlarmsPage() {
  const { patientId } = useParams();
  const unit = useAuthStore((s) => s.resultUnit);
  const { patients } = usePatients();
  const { config, update } = useAlarmConfig(patientId);
  const patient = patients.find((p) => p.patientId === patientId);

  return (
    <SettingsLayout>
      <div className="space-y-6" data-testid="patient-alarms">
        <h2 className="text-lg font-semibold">{patient?.name ?? 'Patient alarms'}</h2>
        {!config ? (
          <p className="text-muted-foreground">Select a patient from the dashboard.</p>
        ) : (
          <>
            <div className="flex justify-between gap-4">
              <p className="text-gray-400">Alarms enabled</p>
              <ToggleSwitch checked={config.enabled} onChange={(enabled) => update({ enabled })} />
            </div>
            <div className="flex justify-between gap-4">
              <p className="text-gray-400">Play sound</p>
              <ToggleSwitch checked={config.sound} onChange={(sound) => update({ sound })} />
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
                    defaultValue={toUnit(config[key], unit)}
                    key={`${key}-${unit}-${config[key]}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) update({ [key]: fromUnit(v, unit) });
                    }}
                  />
                </div>
              ))}
              <div>
                <p className="text-foreground/30 text-xs mb-2">Signal loss (minutes)</p>
                <Input
                  type="number"
                  aria-label="Signal loss minutes"
                  defaultValue={config.signalLossMinutes}
                  key={`loss-${config.signalLossMinutes}`}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) update({ signalLossMinutes: v });
                  }}
                />
              </div>
            </div>
            <Button variant="ghost" onClick={() => window.electron.ipcRenderer.invoke('alarms:reset', patientId)}>
              Reset to sensor defaults
            </Button>
            {patientId && <NightscoutSettings patientId={patientId} />}
          </>
        )}
      </div>
    </SettingsLayout>
  );
}
