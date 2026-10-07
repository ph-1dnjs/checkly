import type { Page } from '@playwright/test'
import type { AuthSession, ProjectSettings } from '../../src/app/ipc/auth/types'

// 로그인 화면·설정 계정 영역을 검사하려고 window.electronAPI.auth를 메모리 가짜로 바꾼다.
// 호출 기록은 sessionStorage('auth-calls')에 남겨 새로고침(프로젝트 변경) 뒤에도 읽을 수 있게 한다.
export type AuthStubOptions = {
  /** false면 getConfig가 enabled:false. 'missing'이면 auth bridge 자체가 없다. */
  enabled: boolean | 'missing'
  session?: AuthSession | null
  remembered?: { projectCode: string; nickname: string } | null
  /** 처음 n번의 getSession을 오프라인처럼 거절한다. */
  offlineSessionChecks?: number
  /** 두 번째 저장부터 충돌로 거절한다. */
  conflictOnSecondSave?: boolean
}

export const owner: AuthSession = {
  userId: 'u-minsu',
  projectId: 'p-team',
  projectCode: 'checkly-team',
  nickname: 'minsu',
  role: 'owner',
}

export const initialSettings: ProjectSettings = {
  endpoints: [
    { id: 'e-web', name: '프론트', kind: 'web', position: 0, updatedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'e-api', name: '백엔드', kind: 'api', position: 1, updatedAt: '2026-10-01T00:00:00.000Z' },
  ],
  environments: [
    { id: 'v-dev', name: 'dev', position: 0, updatedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'v-stg', name: 'staging', position: 1, updatedAt: '2026-10-01T00:00:00.000Z' },
  ],
  urls: [
    { endpointId: 'e-web', environmentId: 'v-dev', baseUrl: 'https://dev.app.com', specUrl: null, updatedAt: '2026-10-01T00:00:00.000Z' },
    { endpointId: 'e-api', environmentId: 'v-dev', baseUrl: 'https://dev-api.app.com', specUrl: 'https://dev-api.app.com/v3/api-docs', updatedAt: '2026-10-01T00:00:00.000Z' },
    { endpointId: 'e-web', environmentId: 'v-stg', baseUrl: 'https://stg.app.com', specUrl: null, updatedAt: '2026-10-01T00:00:00.000Z' },
  ],
}

export async function installAuthStub(page: Page, options: AuthStubOptions) {
  await page.addInitScript(({ options, owner, initialSettings }) => {
    const store = window.sessionStorage
    const loads = Number(store.getItem('auth-loads') || '0') + 1
    store.setItem('auth-loads', String(loads))
    const record = (name: string, args: unknown) => {
      const calls = JSON.parse(store.getItem('auth-calls') || '[]')
      calls.push([name, args])
      store.setItem('auth-calls', JSON.stringify(calls))
    }
    const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

    // 프로젝트 변경으로 새로고침되면 그때 로그인한 세션으로 시작한다.
    const switched = store.getItem('auth-switched')
    let session = switched ? JSON.parse(switched) : (options.session ?? null)
    const listeners = new Set<(next: unknown) => void>()
    const emit = (next: unknown) => {
      session = next
      listeners.forEach((listener) => listener(next))
    }
    const invites: Record<string, { projectCode: string; ownerNickname: string; memberCount: number; createdAt: string; members: string[] }> = {
      'CHK-7Q2M3X': { projectCode: 'checkly-team', ownerNickname: 'minsu', memberCount: 3, createdAt: '2026-03-04T09:00:00.000Z', members: ['minsu', 'hyewon', 'jiho'] },
    }
    const members = [
      { userId: 'u-minsu', nickname: 'minsu', role: 'owner', createdAt: '2026-03-04T09:00:00.000Z' },
      { userId: 'u-hyewon', nickname: 'hyewon', role: 'member', createdAt: '2026-03-05T09:00:00.000Z' },
      { userId: 'u-jiho', nickname: 'jiho', role: 'member', createdAt: '2026-04-11T09:00:00.000Z' },
    ]
    let inviteCode = 'CHK-7Q2M3X'
    let settings = JSON.parse(JSON.stringify(initialSettings))
    let saves = 0
    let sessionChecks = 0

    const auth = {
      getConfig: async () => ({ enabled: options.enabled === true }),
      getSession: async () => {
        await wait()
        sessionChecks += 1
        if (sessionChecks <= (options.offlineSessionChecks ?? 0)) throw new Error('서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.')
        return session
      },
      onSessionChange: (listener: (next: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      signIn: async (input: { projectCode: string; nickname: string; password: string; remember: boolean }) => {
        record('signIn', input)
        await wait()
        if (input.password !== 'secret1') throw new Error('프로젝트 코드, 닉네임 또는 비밀번호가 올바르지 않습니다.')
        const next = input.projectCode === owner.projectCode
          ? { ...owner, nickname: input.nickname }
          : { userId: 'u-other', projectId: `p-${input.projectCode}`, projectCode: input.projectCode, nickname: input.nickname, role: 'member' }
        if (session && session.projectId !== next.projectId) store.setItem('auth-switched', JSON.stringify(next))
        emit(next)
        return next
      },
      signOut: async () => {
        record('signOut', null)
        emit(null)
      },
      getRemembered: async () => options.remembered ?? null,
      listRecentProjects: async () => [
        { projectCode: 'checkly-team', nickname: 'minsu', lastUsedAt: '2026-10-06T09:00:00.000Z' },
        { projectCode: 'partner-api', nickname: 'minsu_p', lastUsedAt: '2026-09-12T09:00:00.000Z' },
      ],
      previewInvite: async (code: string) => {
        record('previewInvite', code)
        await wait()
        const found = invites[code]
        return found ? { projectCode: found.projectCode, ownerNickname: found.ownerNickname, memberCount: found.memberCount, createdAt: found.createdAt } : null
      },
      isProjectCodeAvailable: async (code: string) => (await wait(), code !== 'checkly-team'),
      isNicknameAvailable: async (code: string, nickname: string) => (await wait(), !invites[code]?.members.includes(nickname)),
      createProject: async (input: { code: string; nickname: string; password: string }) => {
        record('createProject', input)
        await wait()
        const next = { userId: 'u-new', projectId: 'p-new', projectCode: input.code, nickname: input.nickname, role: 'owner' }
        emit(next)
        return { session: next, inviteCode: 'NEW-4K8P2Z' }
      },
      joinProject: async (input: { inviteCode: string; nickname: string; password: string }) => {
        record('joinProject', input)
        await wait()
        const next = { userId: 'u-join', projectId: 'p-team', projectCode: invites[input.inviteCode].projectCode, nickname: input.nickname, role: 'member' }
        emit(next)
        return next
      },
      getProject: async () => ({ id: 'p-team', code: 'checkly-team', inviteCode, createdAt: '2026-03-04T09:00:00.000Z', members }),
      regenerateInviteCode: async () => {
        record('regenerateInviteCode', null)
        inviteCode = 'CHK-9X3D4F'
        return inviteCode
      },
      removeMember: async (userId: string) => {
        record('removeMember', userId)
        const index = members.findIndex((member) => member.userId === userId)
        if (index >= 0) members.splice(index, 1)
      },
      changeNickname: async (nickname: string) => {
        record('changeNickname', nickname)
        const next = { ...session, nickname }
        members[0].nickname = nickname
        emit(next)
        return next
      },
      changePassword: async (input: unknown) => {
        record('changePassword', input)
        if ((input as { currentPassword: string }).currentPassword !== 'secret1') throw new Error('현재 비밀번호가 올바르지 않습니다.')
      },
      getProjectSettings: async () => {
        record('getProjectSettings', null)
        return JSON.parse(JSON.stringify(settings))
      },
      saveProjectSettings: async (next: { urls: unknown[] }) => {
        record('saveProjectSettings', next)
        await wait()
        saves += 1
        if (options.conflictOnSecondSave && saves >= 2) {
          // 다른 팀원이 먼저 고친 상태를 흉내 낸다: 새로 불러오면 그 값이 보인다.
          settings.urls[0].baseUrl = 'https://teammate.app.com'
          throw new Error('다른 팀원이 먼저 수정했습니다. 새로 불러온 뒤 다시 저장하세요.')
        }
        settings = JSON.parse(JSON.stringify(next))
        return JSON.parse(JSON.stringify(settings))
      },
    }

    const off = () => () => undefined
    Object.defineProperty(window, 'electronAPI', {
      value: {
        ...(options.enabled === 'missing' ? {} : { auth }),
        loadScenarioMarkdown: async () => null,
        loadMarkerPositions: async () => null,
        saveMarkerPositions: async () => undefined,
        listScenarioFolder: async () => ({ folderPath: null, files: [] }),
        readScenarioFile: async () => null,
        onManualInputRequired: off,
        onManualControlRequired: off,
        onManualResultRequired: off,
        onQaProgress: off,
        onQaPreview: off,
        onQaStepPreview: off,
        onRunVideo: off,
        getAppVersion: async () => '0.1.10',
        getUpdateSettings: async () => ({ autoCheck: true }),
        getUpdateStatus: async () => ({ state: 'idle' }),
        onUpdateStatus: off,
        checkForUpdates: async () => ({ state: 'not-available' }),
        setUpdateAutoCheck: async () => undefined,
        windowSettings: {
          getSettings: async () => ({ fillScreenOnStartup: false, width: 1200, height: 800 }),
          getResolutionPresets: async () => [{ width: 1200, height: 800, label: '1200 × 800' }],
          setFillScreenOnStartup: async () => undefined,
          setResolution: async () => undefined,
        },
      },
    })
  }, { options, owner, initialSettings })
}

export async function authCalls(page: Page): Promise<Array<[string, any]>> {
  return page.evaluate(() => JSON.parse(window.sessionStorage.getItem('auth-calls') || '[]'))
}
