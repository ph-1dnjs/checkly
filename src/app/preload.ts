import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  loadScenarioMarkdown: (): Promise<string | null> => ipcRenderer.invoke('scenario:load'),
  saveScenarioMarkdown: (markdown: string): Promise<void> => ipcRenderer.invoke('scenario:save', markdown),
  importScenarioFile: (): Promise<string | null> => ipcRenderer.invoke('scenario:import-file'),
  exportScenarioFile: (markdown: string): Promise<string | null> => ipcRenderer.invoke('scenario:export-file', markdown),
  loadMarkerPositions: (): Promise<string | null> => ipcRenderer.invoke('marker-positions:load'),
  saveMarkerPositions: (positions: string): Promise<void> => ipcRenderer.invoke('marker-positions:save', positions),
  inspectScenario: (scenario: unknown): Promise<unknown> => ipcRenderer.invoke('qa:inspect', scenario),
  runQa: (scenario: unknown, options?: { preview?: boolean }): Promise<unknown> => ipcRenderer.invoke('qa:start', scenario, options),
  submitManualInput: (value: string): Promise<void> => ipcRenderer.invoke('qa:manual-input', value),
  cancelQa: (): Promise<void> => ipcRenderer.invoke('qa:cancel'),
  onManualInputRequired: (callback: (step: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, step: unknown): void => callback(step)
    ipcRenderer.on('qa:manual-required', listener)
    return () => ipcRenderer.removeListener('qa:manual-required', listener)
  },
  onQaProgress: (callback: (progress: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown): void => callback(progress)
    ipcRenderer.on('qa:progress', listener)
    return () => ipcRenderer.removeListener('qa:progress', listener)
  },
  onQaPreview: (callback: (image: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, image: unknown): void => callback(image)
    ipcRenderer.on('qa:preview', listener)
    return () => ipcRenderer.removeListener('qa:preview', listener)
  }
})
