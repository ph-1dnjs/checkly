import { ipcRenderer } from 'electron'
import { subscribe } from '../subscribe'
import type { AuthResult } from './errors'
import type { AuthBridge, AuthSession } from './types'

// main은 실패를 { ok: false, message }로 돌려준다. 여기서 Error로 바꿔 message가 접두어 없이 보이게 한다.
const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
  const result = (await ipcRenderer.invoke(`auth:${method}`, ...args)) as AuthResult<T>
  if (!result.ok) throw new Error(result.message)
  return result.value
}

export const authBridge: AuthBridge = {
  getConfig: () => call('getConfig'),
  getSession: () => call('getSession'),
  onSessionChange: (listener) => subscribe<AuthSession | null>('auth:session', listener),
  signIn: (input) => call('signIn', input),
  signOut: () => call('signOut'),
  getSignOutNotice: () => call('getSignOutNotice'),
  getRemembered: () => call('getRemembered'),
  listRecentProjects: () => call('listRecentProjects'),
  previewInvite: (inviteCode) => call('previewInvite', inviteCode),
  isProjectCodeAvailable: (code) => call('isProjectCodeAvailable', code),
  isNicknameAvailable: (inviteCode, nickname) => call('isNicknameAvailable', inviteCode, nickname),
  createProject: (input) => call('createProject', input),
  joinProject: (input) => call('joinProject', input),
  getProject: () => call('getProject'),
  regenerateInviteCode: () => call('regenerateInviteCode'),
  removeMember: (userId) => call('removeMember', userId),
  changeNickname: (nickname) => call('changeNickname', nickname),
  changePassword: (input) => call('changePassword', input),
  getProjectSettings: () => call('getProjectSettings'),
  saveProjectSettings: (settings) => call('saveProjectSettings', settings),
}
