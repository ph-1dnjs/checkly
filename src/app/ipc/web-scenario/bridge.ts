import { ipcRenderer } from 'electron'
import type { AuthResult } from '../auth/errors'
import type { WebScenarioBridge } from './types'

const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
  const result: AuthResult<T> = await ipcRenderer.invoke(`web-scenario:${method}`, ...args)
  if (!result.ok) throw new Error(result.message)
  return result.value
}
export const webScenarioBridge: WebScenarioBridge = {
  list: () => call('list'),
  save: input => call('save', input),
  remove: (id, version) => call('remove', id, version),
}
export const selectUploadFile = (): Promise<string | null> => ipcRenderer.invoke('qa:select-upload-file')
