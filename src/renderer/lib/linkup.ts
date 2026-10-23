import {
  Connection,
  LinkUpClient,
  LinkUpError,
  Session,
} from '../../shared/linkup'

// Thin adapters over the shared client for the existing renderer pages.
// Multi-patient UI (step 4) will use the shared client/poller directly.

type GetGeneralRequest = Session

const sessionClient = (s: Session) =>
  new LinkUpClient({
    credentials: { country: s.country, username: '', password: '' },
    session: s,
  })

export async function getAuthToken(request: {
  country: string
  username: string
  password: string
}): Promise<
  { token: string; accountId: string; accountCountry: string } | { error: number }
> {
  const client = new LinkUpClient({ credentials: request })
  try {
    const s = await client.login()
    return { token: s.token, accountId: s.accountId, accountCountry: s.country }
  } catch (error) {
    if (error instanceof LinkUpError && error.kind === 'auth' && error.status) {
      return { error: error.status }
    }
    console.log('Unable to get the token: ', error)
    throw error
  }
}

export async function getCGMData(
  request: GetGeneralRequest,
): Promise<Connection | null | { error: string; message: string }> {
  try {
    const client = sessionClient(request)
    const connections = await client.getConnections()
    if (connections.length === 0) {
      return {
        error: 'NO_CONNECTIONS',
        message:
          'No LibreLinkUp connections found. Please set up a connection in your Libre app.',
      }
    }
    return (await client.getGraph(connections[0].patientId)).connection
  } catch (error) {
    console.log('Unable to getCGMData: ', error)
  }
  return null
}

export async function getConnection(
  request: GetGeneralRequest,
): Promise<Connection | null> {
  try {
    return (await sessionClient(request).getConnections())[0] ?? null
  } catch (error) {
    console.log('Unable to getConnection: ', error)
  }
  return null
}
