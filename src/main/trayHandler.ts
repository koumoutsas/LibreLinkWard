import { ipcMain, BrowserWindow } from "electron";
import { createTray, hasTray, updateTrayReadings, destroyTray, TrayReading } from './../renderer/lib/trayManager';

let mainWindow: BrowserWindow | null = null;

export const registerTrayHandler = () => {

  ipcMain.on('update-tray-readings', (event, readings: TrayReading[], unit: string) => {
    try {
      if (!hasTray() && mainWindow) createTray(mainWindow);
      updateTrayReadings(readings, unit);
    } catch (error) {
      console.error('Error updating tray readings:', error);
      if (mainWindow) {
        createTray(mainWindow);
        updateTrayReadings(readings, unit);
      }
    }
  });

  ipcMain.on('create-tray', (event) => {
    if (mainWindow) {
      createTray(mainWindow);
    }
  });

  ipcMain.on('destroy-tray', (event) => {
    destroyTray();
  });
};

export const destroyTrayHandler = () => {
  ipcMain.removeAllListeners('update-tray-readings');
  ipcMain.removeAllListeners('create-tray');
  ipcMain.removeAllListeners('destroy-tray');
};

export const setTrayMainWindow = (window: BrowserWindow) => {
  mainWindow = window;
};
