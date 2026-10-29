/* eslint global-require: off, no-console: off, promise/always-return: off */
import path from "path"
import { app, BrowserWindow, ipcMain, shell } from "electron"
// import { autoUpdater } from "electron-updater"
// import log from "electron-log"
import MenuBuilder from "./menu"
import { resolveHtmlPath } from "./util"
import { WindowStateManager, WindowState } from './windowState';
import { registerWindowHandlers, destroyWindowHandlers } from "./windowHandler";
import { registerLogoutHandler, destroyLogoutHandler } from "./logoutHandler";
import { registerRefreshHandler, destroyRefreshHandler } from "./refreshHandler";
import { registerAlertHandler, destroyAlertHandler } from "./alertHandler";
import { registerPollingHandler, destroyPollingHandler } from "./pollingHandler";
import { registerTrayHandler, destroyTrayHandler, setTrayMainWindow } from "./trayHandler";
import { destroyTray } from './../renderer/lib/trayManager';

// class AppUpdater {
//   constructor() {
//     log.transports.file.level = 'info'
//     autoUpdater.logger = log
//     autoUpdater.checkForUpdatesAndNotify()
//   }
// }

let mainWindow: BrowserWindow | null = null
let isQuitting = false

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support')
  sourceMapSupport.install()
}

const createWindow = async () => {
  const windowOptions = getWindowOptions();

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.isPrimary = true;

  // 👉 save window state
  const defaultWindowState: WindowState = {
    width: 1024,
    height: 728,
  };

  const windowStateManager = new WindowStateManager('main', defaultWindowState);
  windowStateManager.manage(mainWindow);

  mainWindow.loadURL(resolveHtmlPath('index.html'))

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined')
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize()
      mainWindow.focus()
    } else {
      mainWindow.show()
    }

    setTrayMainWindow(mainWindow);

  })

  mainWindow.on('close', function (this: BrowserWindow, event) {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      try {
        this.hide();
      } catch {
        // no-op: window may already be tearing down under hot-reload
      }
      return;
    }
    // allow close on non-mac or when quitting
  });


  mainWindow.on('closed', () => {
    mainWindow = null;
    destroyTray();
  })

  app.on('before-quit', () => {
   isQuitting = true;
   destroyPollingHandler();
  });

  const menuBuilder = new MenuBuilder(mainWindow)
  menuBuilder.buildMenu()

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url)
    return { action: 'deny' }
  })

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  // new AppUpdater()
}

const getWindowOptions = (): Electron.BrowserWindowConstructorOptions => ({
  show: false,
  width: 1024,
  height: 728,
  minWidth: 200,
  minHeight: 45,
  frame: true,
  webPreferences: {
    webSecurity: false,
    preload: app.isPackaged
      ? path.join(__dirname, 'preload.js')
      : path.join(__dirname, '../../.erb/dll/preload.js'),
  },
  resizable: true,
  movable: true,
})


/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  destroyWindowHandlers();
  destroyLogoutHandler();
  destroyRefreshHandler();
  destroyAlertHandler();
  destroyTrayHandler();
  destroyTray();
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app
  .whenReady()
  .then(() => {
    // safeStorage is only usable once the app is ready
    registerPollingHandler()
    createWindow()
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      // if (mainWindow === null) createWindow()
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        } else {
          // If windows exist but are minimized or hidden, show them
          BrowserWindow.getAllWindows().forEach(win => {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          });
        }
    })
  })
  .catch(console.log)

// Utils that calls invoke
ipcMain.handle('ipc-open-file', async (event, ...args) => {
  const appPath = app.isPackaged
    ? app.getAppPath()
    : path.join(__dirname, '..')

  const filePath = path.join(appPath, '..', 'assets', 'resources', ...args)
  shell.openPath(filePath)
})


registerWindowHandlers();
registerLogoutHandler();
registerRefreshHandler();
registerAlertHandler();
registerTrayHandler();

export const getMainWindow = () => mainWindow;
