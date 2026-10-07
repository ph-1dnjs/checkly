import { ipcRenderer } from 'electron'

export const scenarioFileBridge = {
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
}
