/** @jest-environment node */
import { Poller, LinkUpError } from '..'

const graph = (id: string) => ({ connection: { patientId: id }, graphData: [] })

describe('Poller', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('polls every patient each tick', async () => {
    const client = {
      getConnections: jest.fn().mockResolvedValue([{ patientId: 'a' }, { patientId: 'b' }]),
      getGraph: jest.fn(async (id: string) => graph(id)),
    }
    const onUpdate = jest.fn()
    const p = new Poller({ client, onUpdate, intervalMs: 1000 })
    expect(await p.tick()).toBe(true)
    expect(onUpdate.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('isolates per-patient failures and reports them', async () => {
    const client = {
      getConnections: jest.fn().mockResolvedValue([{ patientId: 'a' }, { patientId: 'b' }]),
      getGraph: jest.fn(async (id: string) => {
        if (id === 'a') throw new LinkUpError('x', 'network')
        return graph(id)
      }),
    }
    const onUpdate = jest.fn()
    const onError = jest.fn()
    const p = new Poller({ client, onUpdate, onError })
    expect(await p.tick()).toBe(false)
    expect(onUpdate).toHaveBeenCalledWith('b', expect.anything())
    expect(onError).toHaveBeenCalledWith(expect.any(LinkUpError), 'a')
  })

  it('stops the tick on rate limit', async () => {
    const client = {
      getConnections: jest.fn().mockResolvedValue([{ patientId: 'a' }, { patientId: 'b' }]),
      getGraph: jest.fn().mockRejectedValue(new LinkUpError('x', 'rate-limit', 429)),
    }
    await new Poller({ client, onUpdate: jest.fn() }).tick()
    expect(client.getGraph).toHaveBeenCalledTimes(1)
  })

  it('backs off on errors, caps, and resets on success', async () => {
    const client = {
      getConnections: jest.fn().mockRejectedValue(new Error('down')),
      getGraph: jest.fn(),
    }
    const p = new Poller({ client, onUpdate: jest.fn(), intervalMs: 1000, maxBackoffMs: 4000 })
    p.start()
    await jest.advanceTimersByTimeAsync(0) // first tick -> next in 2000
    expect(client.getConnections).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(2000) // -> next in 4000
    expect(client.getConnections).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(4000) // capped at 4000
    expect(client.getConnections).toHaveBeenCalledTimes(3)
    await jest.advanceTimersByTimeAsync(4000)
    expect(client.getConnections).toHaveBeenCalledTimes(4)
    client.getConnections.mockResolvedValue([])
    await jest.advanceTimersByTimeAsync(4000) // success -> next in 1000
    await jest.advanceTimersByTimeAsync(1000)
    expect(client.getConnections).toHaveBeenCalledTimes(6)
    p.stop()
  })

  it('stop() cancels scheduling', async () => {
    const client = { getConnections: jest.fn().mockResolvedValue([]), getGraph: jest.fn() }
    const p = new Poller({ client, onUpdate: jest.fn(), intervalMs: 1000 })
    p.start()
    await jest.advanceTimersByTimeAsync(0)
    p.stop()
    await jest.advanceTimersByTimeAsync(5000)
    expect(client.getConnections).toHaveBeenCalledTimes(1)
  })

  it('reports nothing from a request still in flight when stopped', async () => {
    let release!: (v: unknown) => void
    const client = {
      getConnections: jest.fn(() => new Promise((r) => { release = r })),
      getGraph: jest.fn(),
    }
    const onConnections = jest.fn()
    const onError = jest.fn()
    const p = new Poller({ client: client as any, onUpdate: jest.fn(), onConnections, onError })
    p.start()
    p.stop()
    release([{ patientId: 'p1' }])
    await jest.advanceTimersByTimeAsync(0)
    expect(onConnections).not.toHaveBeenCalled()
    expect(client.getGraph).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    ['readings', (settle: { resolve: (v: unknown) => void }) => settle.resolve(graph('p1'))],
    ['an error', (settle: { reject: (e: unknown) => void }) => settle.reject(new LinkUpError('down', 'network'))],
  ])('reports nothing when a patient request in flight at stop returns %s', async (_n, finish) => {
    const settle = {} as { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    const client = {
      getConnections: jest.fn().mockResolvedValue([{ patientId: 'p1' }, { patientId: 'p2' }]),
      getGraph: jest.fn(() => new Promise((resolve, reject) => Object.assign(settle, { resolve, reject }))),
    }
    const onUpdate = jest.fn()
    const onError = jest.fn()
    const p = new Poller({ client: client as any, onUpdate, onError })
    p.start()
    await jest.advanceTimersByTimeAsync(0)
    expect(client.getGraph).toHaveBeenCalledTimes(1)
    p.stop()
    finish(settle as any)
    await jest.advanceTimersByTimeAsync(0)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(client.getGraph).toHaveBeenCalledTimes(1)
  })
})
