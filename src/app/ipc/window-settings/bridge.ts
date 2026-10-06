import { ipcRenderer } from 'electron'
import type { ResolutionPreset, WindowSettings } from './windowSettings'

export const windowSettingsBridge = {
  getSettings: (): Promise<WindowSettings> => ipcRenderer.invoke('window:get-settings'),
  getResolutionPresets: (): Promise<ResolutionPreset[]> => ipcRenderer.invoke('window:get-resolution-presets'),
  setFillScreenOnStartup: (fillScreenOnStartup: boolean): Promise<WindowSettings> => ipcRenderer.invoke('window:set-fill-screen-on-startup', fillScreenOnStartup),
  setResolution: (size: { width: number; height: number }): Promise<WindowSettings> => ipcRenderer.invoke('window:set-resolution', size),
}
