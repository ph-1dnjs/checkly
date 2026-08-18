import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  loadScenarioMarkdown: (): Promise<string | null> => ipcRenderer.invoke('scenario:load'),
  saveScenarioMarkdown: (markdown: string): Promise<void> => ipcRenderer.invoke('scenario:save', markdown),
  inspectScenario: (scenario: unknown): Promise<unknown> => ipcRenderer.invoke('qa:inspect', scenario),
  runQa: (scenario: unknown): Promise<unknown> => ipcRenderer.invoke('qa:start', scenario),
  submitManualInput: (value: string): Promise<void> => ipcRenderer.invoke('qa:manual-input', value),
  cancelQa: (): Promise<void> => ipcRenderer.invoke('qa:cancel'),
  onManualInputRequired: (callback: (step: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, step: unknown): void => callback(step)
    ipcRenderer.on('qa:manual-required', listener)
    return () => ipcRenderer.removeListener('qa:manual-required', listener)
  }
})
