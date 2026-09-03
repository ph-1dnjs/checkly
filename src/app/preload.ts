import { contextBridge, ipcRenderer } from 'electron'

type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:get-status'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  getUpdateSettings: (): Promise<{ autoCheck: boolean }> => ipcRenderer.invoke('update:get-settings'),
  setUpdateAutoCheck: (autoCheck: boolean): Promise<void> => ipcRenderer.invoke('update:set-auto-check', autoCheck),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  loadScenarioMarkdown: (): Promise<string | null> => ipcRenderer.invoke('scenario:load'),
  saveScenarioMarkdown: (markdown: string): Promise<void> => ipcRenderer.invoke('scenario:save', markdown),
  importScenarioFile: (): Promise<{ markdown: string; filePath: string } | null> => ipcRenderer.invoke('scenario:import-file'),
  saveImportedScenarioFile: (markdown: string): Promise<string | null> => ipcRenderer.invoke('scenario:save-imported-file', markdown),
  exportScenarioFile: (markdown: string): Promise<string | null> => ipcRenderer.invoke('scenario:export-file', markdown),
  selectUploadFile: (): Promise<string | null> => ipcRenderer.invoke('qa:select-upload-file'),
  loadMarkerPositions: (): Promise<string | null> => ipcRenderer.invoke('marker-positions:load'),
  saveMarkerPositions: (positions: string): Promise<void> => ipcRenderer.invoke('marker-positions:save', positions),
  listScenarioFolder: (): Promise<{ folderPath: string | null; files: Array<{ name: string; path: string; updatedAt: string }> }> => ipcRenderer.invoke('scenario:list-folder'),
  chooseScenarioFolder: (): Promise<{ folderPath: string | null; files: Array<{ name: string; path: string; updatedAt: string }> }> => ipcRenderer.invoke('scenario:choose-folder'),
  readScenarioFile: (filePath: string): Promise<string | null> => ipcRenderer.invoke('scenario:read-file', filePath),
  inspectScenario: (scenario: unknown): Promise<unknown> => ipcRenderer.invoke('qa:inspect', scenario),
  runQa: (scenario: unknown, options?: { preview?: boolean; workerId?: string; headed?: boolean }): Promise<unknown> => ipcRenderer.invoke('qa:start', scenario, options),
  finishQaWorker: (workerId: string): Promise<void> => ipcRenderer.invoke('qa:finish-worker', workerId),
  downloadRunVideo: (filePath: string): Promise<string | null> => ipcRenderer.invoke('qa:download-run-video', filePath),
  mergeRunVideos: (filePaths: string[]): Promise<string | null> => ipcRenderer.invoke('qa:merge-run-videos', filePaths),
  submitManualInput: (value: string): Promise<void> => ipcRenderer.invoke('qa:manual-input', value),
  submitManualControl: (result: { status: 'continue' | 'failed'; reason?: string }): Promise<void> => ipcRenderer.invoke('qa:manual-control', result),
  controlManualBrowser: (event: { type: 'click' | 'wheel' | 'key' | 'text'; x?: number; y?: number; deltaY?: number; key?: string; text?: string }): Promise<void> => ipcRenderer.invoke('qa:manual-browser-event', event),
  setQaViewport: (size: { width: number; height: number }): Promise<void> => ipcRenderer.invoke('qa:set-viewport', size),
  submitManualResult: (result: { status: 'passed' | 'failed'; reason?: string }): Promise<void> => ipcRenderer.invoke('qa:manual-result', result),
  cancelQa: (): Promise<void> => ipcRenderer.invoke('qa:cancel'),
  onManualInputRequired: (callback: (step: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, step: unknown): void => callback(step)
    ipcRenderer.on('qa:manual-required', listener)
    return () => ipcRenderer.removeListener('qa:manual-required', listener)
  },
  onManualResultRequired: (callback: (step: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, step: unknown): void => callback(step)
    ipcRenderer.on('qa:manual-result-required', listener)
    return () => ipcRenderer.removeListener('qa:manual-result-required', listener)
  },
  onManualControlRequired: (callback: (step: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, step: unknown): void => callback(step)
    ipcRenderer.on('qa:manual-control-required', listener)
    return () => ipcRenderer.removeListener('qa:manual-control-required', listener)
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
  },
  onQaStepPreview: (callback: (preview: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, preview: unknown): void => callback(preview)
    ipcRenderer.on('qa:step-preview', listener)
    return () => ipcRenderer.removeListener('qa:step-preview', listener)
  },
  onRunVideo: (callback: (filePath: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, filePath: unknown): void => callback(filePath)
    ipcRenderer.on('qa:run-video', listener)
    return () => ipcRenderer.removeListener('qa:run-video', listener)
  }
})
