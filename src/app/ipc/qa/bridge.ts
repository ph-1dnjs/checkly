import { ipcRenderer } from 'electron'
import { subscribe } from '../subscribe'

export const qaBridge = {
  inspectScenario: (scenario: unknown): Promise<unknown> => ipcRenderer.invoke('qa:inspect', scenario),
  runQa: (scenario: unknown, options?: { preview?: boolean; workerId?: string; headed?: boolean }): Promise<unknown> => ipcRenderer.invoke('qa:start', scenario, options),
  finishQaWorker: (workerId: string): Promise<void> => ipcRenderer.invoke('qa:finish-worker', workerId),
  downloadRunVideo: (filePath: string): Promise<string | null> => ipcRenderer.invoke('qa:download-run-video', filePath),
  mergeRunVideos: (filePaths: string[]): Promise<string | null> => ipcRenderer.invoke('qa:merge-run-videos', filePaths),
  saveRunReport: (markdown: string, fileName: string): Promise<string | null> => ipcRenderer.invoke('qa:save-run-report', markdown, fileName),
  submitManualInput: (value: string): Promise<void> => ipcRenderer.invoke('qa:manual-input', value),
  submitManualControl: (result: { status: 'continue' | 'failed'; reason?: string }): Promise<void> => ipcRenderer.invoke('qa:manual-control', result),
  controlManualBrowser: (event: { type: 'click' | 'wheel' | 'key' | 'text'; x?: number; y?: number; deltaY?: number; key?: string; text?: string }): Promise<void> => ipcRenderer.invoke('qa:manual-browser-event', event),
  setQaViewport: (size: { width: number; height: number }): Promise<void> => ipcRenderer.invoke('qa:set-viewport', size),
  submitManualResult: (result: { status: 'passed' | 'failed'; reason?: string }): Promise<void> => ipcRenderer.invoke('qa:manual-result', result),
  cancelQa: (options?: { keepWorker?: boolean }): Promise<void> => ipcRenderer.invoke('qa:cancel', options),
  onManualInputRequired: (callback: (step: unknown) => void): (() => void) => subscribe('qa:manual-required', callback),
  onManualResultRequired: (callback: (step: unknown) => void): (() => void) => subscribe('qa:manual-result-required', callback),
  onManualControlRequired: (callback: (step: unknown) => void): (() => void) => subscribe('qa:manual-control-required', callback),
  onQaProgress: (callback: (progress: unknown) => void): (() => void) => subscribe('qa:progress', callback),
  onQaPreview: (callback: (image: unknown) => void): (() => void) => subscribe('qa:preview', callback),
  onQaStepPreview: (callback: (preview: unknown) => void): (() => void) => subscribe('qa:step-preview', callback),
  onRunVideo: (callback: (filePath: unknown) => void): (() => void) => subscribe('qa:run-video', callback),
}
