import { ipcRenderer } from 'electron'

export const formAutomationBridge = {
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
