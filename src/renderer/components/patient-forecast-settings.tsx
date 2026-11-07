import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useForecastSettings, useForecastStore } from '@/stores/forecast'

const toValue = (v?: boolean) => (v === undefined ? 'global' : v ? 'on' : 'off')
const fromValue = (v: string) => (v === 'global' ? undefined : v === 'on')

function Choice({ label, value, onChange }: { label: string; value?: boolean; onChange: (v?: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-row items-center justify-between gap-4">
      <p className="text-gray-400">{label}</p>
      <Select value={toValue(value)} onValueChange={(v) => onChange(fromValue(v))}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="global">{t('Use global setting')}</SelectItem>
          <SelectItem value="on">{t('On')}</SelectItem>
          <SelectItem value="off">{t('Off')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** Per-patient override of the global AR2 forecast and cone settings. */
export function PatientForecastSettings({ patientId }: { patientId: string }) {
  const { t } = useTranslation()
  const { showForecast, override } = useForecastSettings(patientId)
  const setForecast = useForecastStore((s) => s.setForecast)
  const setCone = useForecastStore((s) => s.setCone)
  return (
    <div className="space-y-4" data-testid={`forecast-settings-${patientId}`}>
      <h4 className="text-gray-400">{t('Forecast')}</h4>
      <Choice label={t('Show AR2 forecast')} value={override?.showForecast} onChange={(v) => setForecast(patientId, v)} />
      {showForecast && (
        <Choice label={t('Show forecast cone')} value={override?.showForecastCone} onChange={(v) => setCone(patientId, v)} />
      )}
    </div>
  )
}
