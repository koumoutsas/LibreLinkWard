import { ipcMain, BrowserWindow } from "electron";
import { createTray, hasTray, updateTrayReadings, destroyTray, TrayReading } from './../renderer/lib/trayManager';

let mainWindow: BrowserWindow | null = null;

export const registerTrayHandler = () => {

  ipcMain.on('update-tray-readings', (event, readings: TrayReading[], unit: string) => {
    try {
      if (readings.length > 0 && !hasTray() && mainWindow) createTray(mainWindow);
      updateTrayReadings(readings, unit);
    } catch (error) {
      console.error('Error updating tray readings:', error);
      if (mainWindow) {
        createTray(mainWindow);
        updateTrayReadings(readings, unit);
      }
    }
  });

  ipcMain.on('create-tray', () => {
    if (mainWindow) {
      createTray(mainWindow);
    }
  });

  ipcMain.on('destroy-tray', () => {
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
