import { ipcRenderer } from 'electron'
import { subscribe } from '../subscribe'
import type { LiveSessionBridge } from './types'

export const liveSessionBridge: LiveSessionBridge = {
  downloadVideo: (id, documentId, scope) => ipcRenderer.invoke('live-session:download-video', id, documentId, scope),
  list: (scope) => ipcRenderer.invoke('live-session:list', scope),
  read: (id, scope) => ipcRenderer.invoke('live-session:read', id, scope),
  remove: (id, scope) => ipcRenderer.invoke('live-session:remove', id, scope),
  upload: (ids) => ipcRenderer.invoke('live-session:upload', ids),
  onChanged: (callback) => subscribe('live-session:changed', callback),
}
