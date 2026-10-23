import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from 'recharts'
import type { GraphPoint } from '../../shared/linkup'
import { ChartPoint, toChartData, toUnit } from '@/lib/glucose'

type Props = {
  history: GraphPoint[]
  unit: string
  targetLow: number
  targetHigh: number
  windowMs: number
  /** Sparkline: no axes or grid, tooltip kept. */
  compact?: boolean
  height?: number
}

const formatTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function GraphTooltip({ active, payload, unit }: TooltipProps<number, string> & { unit: string }) {
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
  height = 300,
}: Props) {
  const data = toChartData(history, unit, windowMs)
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No data
      </div>
    )
  }
  const values = data.map((d) => d.value)
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
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
