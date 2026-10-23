import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, BellIcon } from '@radix-ui/react-icons';
import { BaseLayout } from '@/layouts/base-layout';
import { Button } from '@/components/ui/button';
import { PatientGraph } from '@/components/patient-graph';
import { TrendArrow } from '@/components/ui/trend-arrow';
import { usePatients } from '@/hooks/usePatients';
import { useAlarmConfig } from '@/hooks/useAlarmConfig';
import { useAuthStore } from '@/stores/auth';
import { formatGlucose } from '@/lib/glucose';
import { openNewWindow, setRedirectTo } from '@/lib/utils';

const HOUR = 60 * 60 * 1000;
const RANGES = [3, 6, 12];

export default function PatientPage() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const unit = useAuthStore((s) => s.resultUnit);
  const { patients } = usePatients();
  const { config } = useAlarmConfig(patientId);
  const [hours, setHours] = useState(6);
  const patient = patients.find((p) => p.patientId === patientId);

  const openAlarms = () => {
    const path = `/settings/patients/${patientId}`;
    setRedirectTo(path);
    openNewWindow(path, 1024, 768);
  };

  return (
    <BaseLayout className="p-4">
      <Button variant="ghost" onClick={() => navigate('/dashboard')}>
        <ArrowLeftIcon className="h-5 w-5 mr-2" />
        Patients
      </Button>
      {!patient ? (
        <p className="mt-4 text-muted-foreground">Patient not found.</p>
      ) : (
        <>
          <div className="flex items-center justify-between mt-4">
            <h1 className="text-2xl font-semibold">{patient.name}</h1>
            <div className="flex items-center gap-2 text-3xl font-semibold">
              {formatGlucose(patient.latest?.ValueInMgPerDl, unit)}
              <span className="text-sm font-normal">{unit}</span>
              {patient.latest && <TrendArrow className="h-6 w-6" trend={patient.latest.TrendArrow ?? 3} />}
            </div>
          </div>
          <div className="flex items-center justify-between my-3">
            <div className="flex gap-1">
              {RANGES.map((h) => (
                <Button key={h} size="sm" variant={h === hours ? 'default' : 'ghost'} onClick={() => setHours(h)}>
                  {h} h
                </Button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={openAlarms}>
              <BellIcon className="h-4 w-4 mr-2" />
              Alarms
            </Button>
          </div>
          <div className="text-foreground/70">
            <PatientGraph
              history={patient.history}
              unit={unit}
              targetLow={config?.low ?? patient.targetLow ?? 70}
              targetHigh={config?.high ?? patient.targetHigh ?? 180}
              windowMs={hours * HOUR}
              height={380}
            />
          </div>
        </>
      )}
    </BaseLayout>
  );
}
