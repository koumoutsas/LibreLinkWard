import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GearIcon } from '@radix-ui/react-icons';
import { BaseLayout } from '@/layouts/base-layout';
import { LoadingScreen } from '@/components/ui/loading';
import { PatientCard } from '@/components/patient-card';
import { usePatients } from '@/hooks/usePatients';
import { useAuthStore } from '@/stores/auth';
import { openNewWindow, setRedirectTo, updateTrayNumber } from '@/lib/utils';
import { toUnit } from '@/lib/glucose';

export default function DashboardPage() {
  const navigate = useNavigate();
  const unit = useAuthStore((s) => s.resultUnit);
  const { patients, status, loaded } = usePatients();

  // The tray shows a single number, so it only follows a lone patient.
  const only = patients.length === 1 ? patients[0] : undefined;
  const trayValue = only?.latest?.ValueInMgPerDl;
  useEffect(() => {
    if (trayValue !== undefined) {
      updateTrayNumber(toUnit(trayValue, unit), only?.targetLow ?? 70, only?.targetHigh ?? 180);
    }
  }, [trayValue, unit]);

  const openSettings = (path: string) => {
    setRedirectTo(path);
    openNewWindow(path, 1024, 768);
  };

  if (!loaded) return <LoadingScreen />;

  return (
    <BaseLayout className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Patients</h1>
        <button
          onClick={() => openSettings('/settings/general')}
          className="p-2 rounded-md hover:bg-foreground/10"
          aria-label="Settings"
        >
          <GearIcon className="h-5 w-5" />
        </button>
      </div>
      {patients.length === 0 ? (
        <p className="text-muted-foreground" data-testid="no-patients">
          {status === 'signed-out'
            ? 'Not signed in.'
            : 'No patients are shared with this LibreLinkUp account yet.'}
        </p>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
          {patients.map((p) => (
            <PatientCard key={p.patientId} patient={p} onOpen={(id) => navigate(`/patients/${id}`)} />
          ))}
        </div>
      )}
    </BaseLayout>
  );
}
