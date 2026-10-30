import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { useAuthStore } from '../stores/auth'
import CryptoJS from 'crypto-js';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function openFile(type: string, folder: string, group: string, filename: string) {
  await window.electron.ipcRenderer.invoke('ipc-open-file', type, folder, group, filename)
}

export async function openNewWindow(path: string, width: number, height: number) {
 await window.electron.ipcRenderer.sendMessage('open-new-window', path, width, height)
}

export async function setRedirectTo (path: string) {
  await localStorage.setItem('redirectTo', path)
}

export async function getRedirectTo () {
  return localStorage.getItem('redirectTo')
}

export async function clearRedirectTo () {
  await localStorage.removeItem('redirectTo')
}

export function sendLogout() {
  setTrayVisibility(false);
  window.electron.ipcRenderer.sendMessage('logout')
}

export function sendRefreshAllWindows() {
  window.electron.ipcRenderer.sendMessage('refresh-all')
}

export function sendRefreshPrimaryWindow() {
  window.electron.ipcRenderer.sendMessage('refresh-primary')
}

export function triggerWarningAlert(alertOptions: any){
  window.electron.ipcRenderer.sendMessage('trigger-warning-alerts', alertOptions)
}

export async function getAlertSoundFile() {
  return await window.electron.ipcRenderer.invoke('get-alert-sound-file')
}

export async function uploadCustomAlertSoundFile(fileData: Array<number>) {
  return await window.electron.ipcRenderer.invoke(
    'upload-custom-alert-sound',
    fileData,
  );
}

export function getUserValue(value: number): number {
  const { resultUnit } = useAuthStore.getState()

  if (resultUnit === 'mg/dL') {
    return Math.round(value)
  }

  if (resultUnit === 'mmol/L') {
    const convertedValue = value / 18.0182
    return parseFloat(convertedValue.toFixed(1))
  }

  throw new Error(`Unsupported result unit: ${resultUnit}`)
}

export function getUserUnit(): string {
  const { resultUnit } = useAuthStore.getState()

  return resultUnit
}

export function hash256(input: string): string {
  return CryptoJS.SHA256(input).toString(CryptoJS.enc.Hex);
}

export type TrayReading = { name: string; mgdl: number; targetLow?: number; targetHigh?: number; trend?: number; stale?: boolean }

/** Sends every monitored patient's latest reading; the tray badge shows the highest. */
export function updateTrayReadings(readings: TrayReading[]) {
  const trayVisible = localStorage.getItem('trayVisible') !== '0';
  if (!trayVisible) return;

  const { resultUnit } = useAuthStore.getState();
  window.electron?.ipcRenderer?.sendMessage('update-tray-readings', readings, resultUnit);
}


export const getTrayVisibility = (): boolean => {
  const trayVisible = localStorage.getItem('trayVisible');
  return trayVisible !== '0';
};

export const setTrayVisibility = async (visible: boolean) => {
  localStorage.setItem('trayVisible', visible ? '1' : '0');

  if (visible) {
    await window.electron.ipcRenderer.sendMessage('create-tray');
  } else {
    await window.electron.ipcRenderer.sendMessage('destroy-tray');
  }
};
