import { ipcRenderer } from 'electron'

// preload 전용: main → renderer 이벤트를 구독하고 구독 해제 함수를 돌려준다.
export const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
