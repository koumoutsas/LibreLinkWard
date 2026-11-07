import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type Choice = 'global' | 'on' | 'off'
export const toChoice = (v?: boolean): Choice => (v === undefined ? 'global' : v ? 'on' : 'off')
export const fromChoice = (v: Choice) => (v === 'global' ? undefined : v === 'on')

function ChoiceSelect({ label, value, onChange }: { label: string; value: Choice; onChange: (v: Choice) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-row items-center justify-between gap-4">
      <p className="text-gray-400">{label}</p>
      <Select value={value} onValueChange={(v) => onChange(v as Choice)}>
        <SelectTrigger className="w-[180px]" aria-label={label}>
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

type Props = { forecast: Choice; cone: Choice; onForecast: (v: Choice) => void; onCone: (v: Choice) => void }

/** Per-patient forecast overrides. Saved together with the alarm settings. */
export function ForecastChoices({ forecast, cone, onForecast, onCone }: Props) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4" data-testid="forecast-settings">
      <h4 className="text-gray-400">{t('Forecast')}</h4>
      <ChoiceSelect label={t('Show AR2 forecast')} value={forecast} onChange={onForecast} />
      <ChoiceSelect label={t('Show forecast cone')} value={cone} onChange={onCone} />
    </div>
  )
}
