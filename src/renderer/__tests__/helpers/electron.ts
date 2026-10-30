/** Shared jsdom stubs for renderer tests: matchMedia, ResizeObserver and the preload bridge. */
export function stubBrowser() {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as any
  ;(global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

type Handler = (channel: string, ...args: any[]) => unknown

/** Installs `window.electron`; returns the mocks and a way to fire events main would send. */
export function stubElectron(invoke: Handler = async () => undefined) {
  const listeners = new Map<string, Array<(...a: any[]) => void>>()
  const ipcRenderer = {
    on: jest.fn((channel: string, fn: (...a: any[]) => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), fn])
      return () => listeners.set(channel, (listeners.get(channel) ?? []).filter((f) => f !== fn))
    }),
    sendMessage: jest.fn(),
    once: jest.fn(),
    invoke: jest.fn(invoke),
  }
  ;(window as any).electron = { ipcRenderer }
  const emit = (channel: string, ...args: any[]) => (listeners.get(channel) ?? []).forEach((f) => f(...args))
  return { ipcRenderer, emit }
}
