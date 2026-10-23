export {};

declare global {
  namespace Electron {
    interface BrowserWindow {
      /** Set on the main window so logout/refresh handlers can tell it apart. */
      isPrimary?: boolean;
    }
  }
}
