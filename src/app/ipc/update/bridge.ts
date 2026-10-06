import { ipcRenderer } from 'electron'
import { subscribe } from '../subscribe'
import type { UpdateStatus } from './update'

export const updateBridge = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:get-status'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  getUpdateSettings: (): Promise<{ autoCheck: boolean }> => ipcRenderer.invoke('update:get-settings'),
  setUpdateAutoCheck: (autoCheck: boolean): Promise<void> => ipcRenderer.invoke('update:set-auto-check', autoCheck),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => subscribe('update:status', callback),
}
