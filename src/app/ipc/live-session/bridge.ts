import { ipcRenderer } from 'electron'
import { subscribe } from '../subscribe'
import type { LiveSessionBridge } from './types'

export const liveSessionBridge: LiveSessionBridge = {
  list: () => ipcRenderer.invoke('live-session:list'),
  read: (id) => ipcRenderer.invoke('live-session:read', id),
  remove: (id) => ipcRenderer.invoke('live-session:remove', id),
  onChanged: (callback) => subscribe('live-session:changed', callback),
}
