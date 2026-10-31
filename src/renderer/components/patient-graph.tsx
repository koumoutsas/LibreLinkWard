import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import type { GraphPoint } from '../../shared/linkup'
import { ChartPoint, toChartData, toUnit } from '@/lib/glucose'
import { ar2Forecast } from '../../shared/forecast'

type Props = {
  history: GraphPoint[]
  unit: string
  targetLow: number
  targetHigh: number
  windowMs: number
  /** Sparkline: no axes or grid, tooltip kept. */
  compact?: boolean
  /** Overlay the AR2 forecast (ignored when compact). */
  forecast?: boolean
  /** Also draw the cone around the forecast. */
  forecastCone?: boolean
  height?: number
}

const formatTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

type GraphTooltipProps = Partial<Pick<TooltipContentProps<number, string>, 'active' | 'payload'>> & { unit: string }

export function GraphTooltip({ active, payload, unit }: GraphTooltipProps) {
  const point = payload?.[0]?.payload as ChartPoint | undefined
  if (!active || !point) return null
  return (
    <div
      role="tooltip"
      data-testid="graph-tooltip"
      className="rounded-md border bg-background px-2 py-1 text-xs shadow"
    >
      <div className="font-semibold">
        {point.value} {unit}
        {point.projected && ' (forecast)'}
      </div>
      <div className="text-muted-foreground">{formatTime(point.t)}</div>
    </div>
  )
}

export function PatientGraph({
  history,
  unit,
  targetLow,
  targetHigh,
  windowMs,
  compact = false,
  forecast = false,
  forecastCone = false,
  height = 300,
}: Props) {
  const actual = toChartData(history, unit, windowMs)
  const data: ChartPoint[] = [...actual]
  if (forecast && !compact && actual.length > 0) {
    const steps = ar2Forecast(actual.map((p) => ({ t: p.t, mgdl: p.mgdl })))
    if (steps.length > 0) {
      const last = actual[actual.length - 1]
      // Anchor the forecast to the newest reading so the lines join up.
      data[data.length - 1] = { ...last, forecast: last.value, forecastHigh: last.value, forecastLow: last.value }
      for (const s of steps) {
        data.push({
          t: s.t,
          mgdl: s.mgdl,
          value: toUnit(s.mgdl, unit),
          projected: true,
          forecast: toUnit(s.mgdl, unit),
          forecastHigh: toUnit(s.high, unit),
          forecastLow: toUnit(s.low, unit),
        })
      }
    }
  }
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No data
      </div>
    )
  }
  const forecastStart = actual.length > 0 ? actual[actual.length - 1].t : undefined
  const forecastEnd = data[data.length - 1].t
  const hasForecast = data.some((d) => d.forecast !== undefined)
  const values = data.flatMap((d) =>
    forecastCone ? [d.value, d.forecastHigh ?? d.value, d.forecastLow ?? d.value] : [d.value],
  )
  const low = toUnit(targetLow, unit)
  const high = toUnit(targetHigh, unit)
  const yMin = Math.min(...values, low)
  const yMax = Math.max(...values, high)
  const pad = unit === 'mmol/L' ? 1 : 10

  return (
    <div style={{ width: '100%', height }} data-testid="patient-graph">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={compact ? { top: 2, right: 2, bottom: 2, left: 2 } : undefined}>
          {!compact && <CartesianGrid strokeDasharray="3 3" opacity={0.3} />}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTime}
            hide={compact}
          />
          <YAxis domain={[yMin - pad, yMax + pad]} hide={compact} width={40} />
          <ReferenceArea y1={low} y2={high} fill="#16a34a" fillOpacity={0.12} ifOverflow="extendDomain" />
          <Tooltip content={<GraphTooltip unit={unit} />} />
          <Line
            dataKey="value"
            type="monotone"
            stroke="currentColor"
            strokeWidth={2}
            dot={compact ? false : { r: 2 }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          {hasForecast && forecastStart !== undefined && (
            <>
              <ReferenceArea x1={forecastStart} x2={forecastEnd} fill="#8b5cf6" fillOpacity={0.08} ifOverflow="extendDomain" />
              <ReferenceLine x={forecastStart} stroke="#8b5cf6" strokeOpacity={0.6} strokeDasharray="3 3" />
              {forecastCone && (
                <>
                  <Line dataKey="forecastHigh" stroke="#8b5cf6" strokeOpacity={0.4} strokeDasharray="2 4" dot={false} activeDot={false} isAnimationActive={false} />
                  <Line dataKey="forecastLow" stroke="#8b5cf6" strokeOpacity={0.4} strokeDasharray="2 4" dot={false} activeDot={false} isAnimationActive={false} />
                </>
              )}
              <Line
                dataKey="forecast"
                data-testid="forecast-line"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 2.5, fill: '#8b5cf6', stroke: '#8b5cf6' }}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
