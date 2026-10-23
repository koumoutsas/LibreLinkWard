export type GlucoseMeasurement = {
  FactoryTimestamp?: string
  Timestamp: string
  type?: number
  ValueInMgPerDl: number
  TrendArrow?: number
  TrendMessage?: string | null
  MeasurementColor?: number
  GlucoseUnits?: number
  Value?: number
  isHigh?: boolean
  isLow?: boolean
}

export type GraphPoint = GlucoseMeasurement

export type Connection = {
  id?: string
  patientId: string
  firstName?: string
  lastName?: string
  targetLow?: number
  targetHigh?: number
  glucoseMeasurement?: GlucoseMeasurement
}

export type GraphResult = {
  connection: Connection
  graphData: GraphPoint[]
  glucoseMeasurement?: GlucoseMeasurement
}

export type Session = {
  token: string
  accountId: string
  country: string
}

export type Credentials = {
  country: string
  username: string
  password: string
}

export class LinkUpError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'rate-limit' | 'network' | 'protocol',
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'LinkUpError'
  }
}

/** Status codes returned by /auth/login in the body (not HTTP). */
export const LOGIN_STATUS = {
  BAD_CREDENTIALS: 2,
  PRIVACY_POLICY: 4,
} as const
