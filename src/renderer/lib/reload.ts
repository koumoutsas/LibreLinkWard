// A seam over window.location.reload: jsdom's location is not configurable, so tests mock this module.
export const reloadApp = (): void => window.location.reload()
