import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GearIcon, PlusIcon } from '@radix-ui/react-icons';
import { BaseLayout } from '@/layouts/base-layout';
import { LoadingScreen } from '@/components/ui/loading';
import { AlarmNotifier } from '@/components/alarm-notifier';
import { PatientCard } from '@/components/patient-card';
import { AddPatientForm } from '@/components/add-patient-form';
import { usePatients } from '@/hooks/usePatients';
import { openNewWindow, setRedirectTo } from '@/lib/utils';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { patients, accounts = [], status, loaded } = usePatients();
  const [adding, setAdding] = useState(false);

  const openSettings = (path: string) => {
    setRedirectTo(path);
    openNewWindow(path, 1024, 768);
  };

  // One section per login, stacked vertically; patients without a known login
  // (e.g. before the first poll) fall into a single unlabelled section.
  const sections = [
    ...accounts.map((account) => ({ account, patients: patients.filter((p) => p.accountId === account.id) })),
    { account: undefined, patients: patients.filter((p) => !accounts.some((a) => a.id === p.accountId)) },
  ].filter((s) => s.patients.length > 0);

  if (!loaded) return <LoadingScreen />;

  return (
    <BaseLayout className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Patients</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAdding((a) => !a)}
            className="flex items-center gap-1 p-2 rounded-md hover:bg-foreground/10 text-sm"
            aria-label="Add patient"
          >
            <PlusIcon className="h-5 w-5" />
            Add patient
          </button>
          <button
            onClick={() => openSettings('/settings/general')}
            className="p-2 rounded-md hover:bg-foreground/10"
            aria-label="Settings"
          >
            <GearIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      {adding && <AddPatientForm onDone={() => setAdding(false)} />}
      <AlarmNotifier />
      {patients.length === 0 ? (
        <p className="text-muted-foreground" data-testid="no-patients">
          {status === 'signed-out'
            ? 'Not signed in.'
            : 'No patients are shared with this LibreLinkUp account yet.'}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map(({ account, patients: list }) => (
            <section key={account?.id ?? 'all'} data-testid={`account-${account?.id ?? 'all'}`}>
              {account && (
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {account.username}
                    {account.status === 'auth-error' && (
                      <span className="ml-2 text-red-600">Sign-in failed: remove and add again</span>
                    )}
                  </span>
                  <button
                    onClick={() => window.electron.ipcRenderer.invoke('linkup:remove-account', account.id)}
                    className="rounded-md px-2 py-1 hover:bg-foreground/10"
                    aria-label={`Remove ${account.username}`}
                  >
                    Remove
                  </button>
                </div>
              )}
              <div className="flex flex-col gap-4">
                {list.map((p) => (
                  <PatientCard key={p.patientId} patient={p} onOpen={(id) => navigate(`/patients/${id}`)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </BaseLayout>
  );
}
