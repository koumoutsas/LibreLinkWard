import { BrowserWindow, ipcMain, app } from 'electron';
import path from 'path';
import { resolveHtmlPath } from './util';

interface WindowCache {
  [url: string]: BrowserWindow | undefined;
}

export const registerWindowHandlers = () => {
  const windowCache: WindowCache = {};


  // 👉 register window handlers
  ipcMain.on('open-new-window', (event, url, width, height) => {
    // Check if the window for this URL already exists
    if (typeof url !== 'string') return;
    if (windowCache[url]) {
      windowCache[url]?.focus();
      return;
    }
    const clamp = (n: unknown, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.min(Math.max(n, 200), 4000) : fallback;

    const newWindow = new BrowserWindow({
      width: clamp(width, 800),
      height: clamp(height, 600),
      webPreferences: {
        webSecurity: false,
        preload: app.isPackaged
          ? path.join(__dirname, 'preload.js')
          : path.join(__dirname, '../../.erb/dll/preload.js'),
      },
    });

    newWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    newWindow.loadURL(resolveHtmlPath('index.html'));
    windowCache[url] = newWindow;


    newWindow.on('closed', () => {
      windowCache[url] = undefined;
    });

  });
};

export const destroyWindowHandlers = () => {
  // 👉 destroy window handlers
  ipcMain.removeAllListeners('open-new-window');
};
