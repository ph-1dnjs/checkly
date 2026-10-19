import { ipcRenderer } from 'electron'
import type { FormAutomationStorageKey, FormAutomationStoredState, FormAutomationStoredValues } from './storageTypes'
import type { NativeInspectorSnapshot, NativeOverride, SimulatorApp, SimulatorDevice, SimulatorFrame, SimulatorInput, SimulatorStatus } from './nativeInspectorTypes'
import { subscribe } from '../subscribe'

export const formAutomationBridge = {
  saveReactNativeModule: (): Promise<string | null> => ipcRenderer.invoke('form-automation:native-save-module'),
  simulatorDevices: (): Promise<SimulatorDevice[]> => ipcRenderer.invoke('form-automation:simulator-devices'),
  simulatorApps: (udid: string): Promise<SimulatorApp[]> => ipcRenderer.invoke('form-automation:simulator-apps', udid),
  simulatorStatus: (): Promise<SimulatorStatus> => ipcRenderer.invoke('form-automation:simulator-status'),
  connectSimulator: (udid: string): Promise<SimulatorStatus> => ipcRenderer.invoke('form-automation:simulator-connect', udid),
  disconnectSimulator: (): Promise<void> => ipcRenderer.invoke('form-automation:simulator-disconnect'),
  launchSimulatorApp: (udid: string, bundleId: string, restart = false): Promise<void> => ipcRenderer.invoke('form-automation:simulator-launch', udid, bundleId, restart),
  simulatorInput: (udid: string, input: SimulatorInput): Promise<void> => ipcRenderer.invoke('form-automation:simulator-input', udid, input),
  onSimulatorFrame: (callback: (frame: SimulatorFrame) => void) => subscribe('form-automation:simulator-frame', callback),
  nativeInspectorSnapshot: (): Promise<NativeInspectorSnapshot> => ipcRenderer.invoke('form-automation:native-snapshot'),
  startNativeInspector: (rules: NativeOverride[]): Promise<NativeInspectorSnapshot> => ipcRenderer.invoke('form-automation:native-start', rules),
  stopNativeInspector: (): Promise<void> => ipcRenderer.invoke('form-automation:native-stop'),
  setNativeInspectorRules: (rules: NativeOverride[]): Promise<void> => ipcRenderer.invoke('form-automation:native-rules', rules),
  clearNativeInspectorEvents: (): Promise<void> => ipcRenderer.invoke('form-automation:native-clear'),
  loadFormAutomationState: (legacy: FormAutomationStoredValues): Promise<FormAutomationStoredState> =>
    ipcRenderer.invoke('form-automation:load-state', legacy),
  setFormAutomationState: (key: FormAutomationStorageKey, value: unknown): Promise<void> =>
    ipcRenderer.invoke('form-automation:set-state', key, value),
  insertFormAutomationText: (input: { webContentsId: number; text: string }): Promise<void> =>
    ipcRenderer.invoke('form-automation:insert-text', input),
  attachFormAutomationFixture: (input: {
    webContentsId: number
    token: string
    valid: boolean
    accept: string
    multiple: boolean
  }): Promise<void> => ipcRenderer.invoke('form-automation:attach-fixture', input),
  captureFormAutomationPage: (): Promise<{ dataUrl: string; size: { width: number; height: number } }> =>
    ipcRenderer.invoke('form-automation:capture-page'),
  copyFormAutomationImage: (dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('form-automation:copy-image', dataUrl),
  copyFormAutomationText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('form-automation:copy-text', text),
  saveFormAutomationSessionEvent: (payload: unknown): Promise<boolean> =>
    ipcRenderer.invoke('form-automation:save-session-event', payload),
  readFormAutomationSessionEvents: (limit = 1000): Promise<unknown[]> =>
    ipcRenderer.invoke('form-automation:read-session-events', limit),
  clearFormAutomationSessionEvents: (): Promise<boolean> =>
    ipcRenderer.invoke('form-automation:clear-session-events'),
  exportFormAutomationSessionEvents: (): Promise<{ filePath: string; count: number; errorCount: number; format: 'xlsx' } | null> =>
    ipcRenderer.invoke('form-automation:export-session-events'),
  requestFormAutomationUrl: (input: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeout?: number
  }): Promise<{ ok: boolean; status: number; statusText: string; text: string; elapsed: number; url: string }> =>
    ipcRenderer.invoke('form-automation:http-request', input),
  pickFormAutomationOpenApi: (): Promise<{ filePath: string; text: string } | null> =>
    ipcRenderer.invoke('form-automation:pick-openapi'),
}
