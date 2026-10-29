import { useParams } from 'react-router-dom';
import SettingsLayout from '@/layouts/settings-layout';
import { Button } from '@/components/ui/button';
import { PatientAlarms } from '@/components/patient-alarms';
import { NightscoutSettings } from '@/components/nightscout-settings';
import { usePatients } from '@/hooks/usePatients';
import { useTranslation } from 'react-i18next';

/** One block per login: its patients' alarms, Nightscout upload (LibreLinkUp only) and logout. */
export default function SettingsAccountsPage() {
  const { t } = useTranslation();
  const { patientId } = useParams();
  const { patients, accounts = [] } = usePatients();

  // Opened from a patient page: show only the login that patient belongs to.
  const focusAccountId = patients.find((p) => p.patientId === patientId)?.accountId;
  const shown = focusAccountId ? accounts.filter((a) => a.id === focusAccountId) : accounts;

  return (
    <SettingsLayout>
      <div className="space-y-10" data-testid="settings-accounts">
        {shown.length === 0 && <p className="text-muted-foreground">No accounts yet.</p>}
        {shown.map((account) => (
          <section key={account.id} className="space-y-6" data-testid={`settings-account-${account.id}`}>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">{account.username}</h2>
              <Button
                variant="outline"
                onClick={() => window.electron.ipcRenderer.invoke('linkup:remove-account', account.id)}
              >
                {t('Logout')}
              </Button>
            </div>
            {patients
              .filter((p) => p.accountId === account.id)
              .map((p) => (
                <div key={p.patientId} className="space-y-6 border-t border-border pt-6">
                  <h3 className="font-semibold">{p.name}</h3>
                  <div className="space-y-4">
                    <h4 className="text-gray-400">{t('Alerts')}</h4>
                    <PatientAlarms patientId={p.patientId} />
                  </div>
                  {account.kind !== 'nightscout' && <NightscoutSettings patientId={p.patientId} />}
                </div>
              ))}
          </section>
        ))}
      </div>
    </SettingsLayout>
  );
}
