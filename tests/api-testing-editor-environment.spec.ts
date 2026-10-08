import { expect, test, type Page } from '@playwright/test'
import { parseScenario, stringifyScenario } from '../src/app/api-testing/shared/scenario'
import type { ApiAiImportResult, ApiAiTerminal, ApiAiChatSettings, ApiAiChatStatus, ApiCatalog, ApiEnvironmentScope, ApiGlobal, ApiProject, ApiScenarioPreview, ApiScope, ApiTestingBridge, SavedApiScenario } from '../src/app/api-testing/shared/workspace'

const projectId = '00000000-0000-4000-8000-000000000001'
const serverId = '00000000-0000-4000-8000-000000000002'
const authServerId = '00000000-0000-4000-8000-000000000007'
const environments = {
  dev: '00000000-0000-4000-8000-000000000003',
  empty: '00000000-0000-4000-8000-000000000004',
  stage: '00000000-0000-4000-8000-000000000005',
  broken: '00000000-0000-4000-8000-000000000006',
}
const importedAt = '2026-09-29T00:00:00.000Z'
const groupPath = ['초안 그룹']

function catalog(path: string, summary: string): ApiCatalog {
  const responses = { '200': { description: '정상 응답' } }
  return {
    title: summary, version: '1', importedAt,
    operations: [{
      key: `GET ${path}`, method: 'GET', path, summary, description: '', tag: '조회',
      parameters: [{ name: 'q', location: 'query', required: false, description: '검색어', type: 'string' }],
      bodyRequired: false, responses, warnings: [],
    }],
    spec: {
      openapi: '3.0.3', info: { title: summary, version: '1' },
      paths: { [path]: { get: {
        tags: ['조회'], summary,
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses,
      } } },
    },
  }
}

function structuredCatalog(summary: string): ApiCatalog {
  const bodySchema = { type: 'object', additionalProperties: true }
  const responses = { '200': { description: '정상 응답' } }
  return {
    title: summary, version: '1', importedAt,
    operations: [{
      key: 'POST /structured', method: 'POST', path: '/structured', summary, description: '', tag: '입력',
      parameters: [{ name: 'filters', location: 'query', required: false, description: '배열 검색 조건', type: 'array' }],
      bodyRequired: true, bodySchema, responses, warnings: [],
    }, ...catalog('/replacement', '대체 API').operations],
    spec: {
      openapi: '3.0.3', info: { title: summary, version: '1' },
      paths: { '/structured': { post: {
        tags: ['입력'], summary,
        parameters: [{ name: 'filters', in: 'query', schema: { type: 'array', items: { type: 'integer' } } }],
        requestBody: { required: true, content: { 'application/json': { schema: bodySchema } } },
        responses,
      } }, '/replacement': { get: {
        tags: ['조회'], summary: '대체 API',
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses,
      } } },
    },
  }
}

// twoServers: the project has a second server. missingGlobals: previewScenario reports globals with no value, per step.
async function workspace(page: Page, structured = false, linkedGlobal = false, options: {
  twoServers?: boolean; missingGlobals?: boolean; extra?: SavedApiScenario[]; failSecondStep?: boolean; cancelRun?: boolean;
  chat?: { current: ApiAiTerminal | null; settings?: ApiAiChatSettings; tools?: ApiAiChatStatus['tools']; result?: { modifiedAt: string; result: ApiAiImportResult } | null };
} = {}) {
  const catalogs: Record<string, ApiCatalog | null> = {
    [environments.dev]: structured ? structuredCatalog('개발 구조 입력') : catalog('/dev-items', '개발 환경 조회'),
    [environments.empty]: null,
    [environments.stage]: structured ? structuredCatalog('스테이징 구조 입력') : catalog('/stage-items', '스테이징 환경 조회'),
  }
  let project: ApiProject = {
    id: projectId, name: '환경 전환 회귀', servers: [{ id: serverId, name: 'API' }, ...(options.twoServers ? [{ id: authServerId, name: '인증' }] : [])],
    environments: Object.entries(environments).map(([name, id]) => ({
      id, name, baseUrls: { [serverId]: `https://${name}.example.invalid`, ...(options.twoServers ? { [authServerId]: `https://auth-${name}.example.invalid` } : {}) },
    })),
  }
  const original = parseScenario(`id: stored-scenario\nname: 저장된 시나리오\ndescription: 저장된 설명\nserver: ${serverId}\nsteps:\n  - api: GET /dev-items\n    query: { q: original }\n`)
  if (linkedGlobal) original.steps[0].request.query = { q: '{{globals.accessToken}}' }
  let globals: ApiGlobal[] = []
  const globalSaves: Parameters<ApiTestingBridge['setGlobal']>[] = []
  let runs = 0
  let saved: SavedApiScenario[] = [{
    id: original.id, name: original.name, source: stringifyScenario(original, true),
    bindings: {}, updatedAt: importedAt, groupPath: ['기존 그룹'],
  }, ...(options.extra ?? [])]
  const saves: Array<{ scope: ApiEnvironmentScope; item: SavedApiScenario }> = []
  const chatMarks: Parameters<ApiTestingBridge['markAiTerminalResultSaved']>[] = []
  const terminalWrites: string[] = []
  const terminalStarts: unknown[] = []
  const chatSettingsSaves: ApiAiChatSettings[] = []
  let saveAttempts = 0
  const requests: string[] = []
  const unexpected: string[] = []
  const gates = new Map<string, Promise<void>>()
  const releases = new Map<string, () => void>()
  const preview = (scope: ApiEnvironmentScope, source: string): ApiScenarioPreview => {
    const scenario = parseScenario(source)
    const operations = catalogs[scope.environmentId]?.operations ?? []
    const issues = scenario.steps.flatMap(step => operations.some(operation => 'method' in step.api && operation.method === step.api.method && operation.path === step.api.path)
      ? [] : [`${step.name ?? step.id}: 명세에 없는 API입니다`])
    // Like the app: one line per step and global that has no value.
    const executionIssues = options.missingGlobals ? scenario.steps.flatMap((step, index) => [...JSON.stringify(step.request).matchAll(/\{\{globals\.([A-Za-z][A-Za-z0-9_]*)\}\}/g)]
      .filter(match => !globals.some(global => global.name === match[1]))
      .map(match => `${index + 1}단계 · ${step.name ?? step.id}: 전역변수 '${match[1]}' 값이 없습니다. 전역변수에서 설정하세요`)) : []
    return { scenario, issues, executionIssues }
  }
  await page.exposeFunction('__apiTestingCall', async (method: string, args: unknown[]) => {
    switch (method) {
      case 'listProjects': return [project]
      case 'saveProject': project = args[0] as ApiProject; return project
      case 'chooseDirectories': return ['/backend/a', '/backend/b']
      case 'listScenarios': return saved
      case 'listSuites':
      case 'listCookies': return []
      case 'listGlobals': return globals
      case 'setGlobal': {
        const [scope, name, value] = args as Parameters<ApiTestingBridge['setGlobal']>
        globalSaves.push([scope, name, value])
        globals = [...globals.filter(item => item.name !== name), { name, type: typeof value, displayValue: typeof value === 'string' ? value : JSON.stringify(value) }]
        return undefined
      }
      case 'runScenario': {
        runs++
        const scenario = parseScenario(args[1] as string)
        if (options.cancelRun) return { status: 'cancelled', variables: {}, steps: scenario.steps.map(step => ({ id: step.id, name: step.name ?? step.id, status: 'cancelled', durationMs: 5, error: '실행 취소' })) }
        // failSecondStep: step 2 answers 500 and later steps are skipped, like the runner.
        if (options.failSecondStep) return { status: 'failed', variables: {}, steps: scenario.steps.map((step, index) => index === 0
          ? { id: step.id, name: step.name ?? step.id, status: 'passed', httpStatus: 200, durationMs: 1, request: { method: 'GET', url: 'https://dev.example.invalid/dev-items', headers: { accept: 'application/json' } }, body: { ok: true }, headers: { 'content-type': 'application/json', date: 'today' } }
          : index === 1 ? { id: step.id, name: step.name ?? step.id, status: 'failed', httpStatus: 500, durationMs: 1, error: 'HTTP 500 응답 (2xx 아님)', body: { message: 'boom' }, headers: { 'content-type': 'application/json' } }
          : { id: step.id, name: step.name ?? step.id, status: 'skipped', durationMs: 0 }) }
        return { status: 'passed', variables: {}, steps: scenario.steps.map(step => ({
          id: step.id, name: step.name ?? step.id, status: 'passed', httpStatus: 200, durationMs: 1,
          body: { message: 'before fresh-secret after' }, headers: {},
        })) }
      }
      case 'getRequestAuth':
      case 'getPendingScenarioInput': return null
      case 'cancel': return undefined
      case 'checkScenarioSpecs': return { missing: [], renamed: [] }
      case 'getSpecSync': return { hasSavedAccount: false, secureStorageAvailable: false }
      case 'getCatalog': {
        const { environmentId } = args[0] as ApiScope
        requests.push(environmentId)
        await gates.get(environmentId)
        if (environmentId === environments.broken) throw new Error('명세 조회 실패 테스트')
        return catalogs[environmentId] ?? null
      }
      case 'previewScenario': return preview(args[0] as ApiEnvironmentScope, args[1] as string)
      case 'saveScenario':
      case 'saveScenarioDraft': {
        saveAttempts++
        await gates.get('scenario-save')
        const [scope, source, bindings, expectedUpdatedAt, metadata] = args as Parameters<ApiTestingBridge['saveScenario']>
        const checked = preview(scope, source)
        const previous = saved.find(item => item.id === checked.scenario.id)
        if (previous && expectedUpdatedAt !== previous.updatedAt) throw new Error('저장된 시나리오의 수정 시각이 유실되었습니다')
        if (method === 'saveScenario' && checked.issues.length) throw new Error(checked.issues.join('\n'))
        const item: SavedApiScenario = {
          id: checked.scenario.id, name: checked.scenario.name,
          source: stringifyScenario(checked.scenario, true), bindings,
          updatedAt: new Date(Date.parse(importedAt) + saves.length + 1).toISOString(),
          draft: method === 'saveScenarioDraft', groupPath: metadata?.groupPath ?? [],
        }
        saved = [...saved.filter(candidate => candidate.id !== item.id), item]
        saves.push({ scope, item })
        return item
      }
      case 'getAiChatStatus':
        await gates.get('ai-status')
        return options.chat ? { tools: options.chat.tools ?? [{ tool: 'claude', version: 'test' }] }
          : { tools: [], error: 'Claude Code나 Codex CLI가 설치되어 있지 않습니다' }
      case 'getAiChatSettings':
        await gates.get('ai-settings')
        return options.chat ? options.chat.settings ?? { folders: { [serverId]: ['/backend'] }, tool: 'claude' } : { folders: {} }
      case 'saveAiChatSettings': {
        const next = args[1] as ApiAiChatSettings
        chatSettingsSaves.push(next)
        if (options.chat) options.chat.settings = next
        return next
      }
      case 'getAiTerminal': return options.chat?.current ?? null
      case 'startAiTerminal': {
        const request = args[0] as Parameters<ApiTestingBridge['startAiTerminal']>[0]
        terminalStarts.push(request)
        options.chat!.current = { tool: options.chat!.settings?.tool ?? 'claude', environmentId: request.scope.environmentId, running: true, buffer: '' }
        return options.chat!.current
      }
      case 'resumeAiTerminal': options.chat!.current!.running = true; return options.chat!.current
      case 'clearAiTerminal': options.chat!.current = null; options.chat!.result = null; return undefined
      case 'writeAiTerminal': terminalWrites.push(args[1] as string); return undefined
      case 'resizeAiTerminal': return undefined
      case 'checkAiTerminalResult': return options.chat?.result ?? null
      case 'refreshAiTerminalFiles': return undefined
      case 'markAiTerminalResultSaved': {
        const input = args as Parameters<ApiTestingBridge['markAiTerminalResultSaved']>
        options.chat!.current!.saved = input[1]
        chatMarks.push(input)
        return undefined
      }
      default:
        unexpected.push(method)
        throw new Error(`Unexpected bridge call: ${method}`)
    }
  })
  await page.addInitScript(() => {
    const call = (window as unknown as { __apiTestingCall: (method: string, args: unknown[]) => Promise<unknown> }).__apiTestingCall
    Object.defineProperty(window, 'electronAPI', { value: {
      loadScenarioMarkdown: async () => null,
      loadMarkerPositions: async () => null,
      saveMarkerPositions: async () => undefined,
      listScenarioFolder: async () => ({ folderPath: null, files: [] }),
      readScenarioFile: async () => null,
      onManualInputRequired: () => () => undefined,
      onManualControlRequired: () => () => undefined,
      onManualResultRequired: () => () => undefined,
      onQaProgress: () => () => undefined,
      onQaPreview: () => () => undefined,
      onQaStepPreview: () => () => undefined,
      onRunVideo: () => () => undefined,
      // Terminal events cannot cross into the test; the subscription is a no-op.
      apiTesting: new Proxy({}, { get: (_target, method: string) => method === 'onAiTerminalEvent' ? () => () => undefined : (...args: unknown[]) => call(method, args) }),
    } })
  })
  await page.goto(`/?tab=scenarios&project=${projectId}&server=${serverId}&environment=${environments.dev}`)
  await page.getByRole('button', { name: 'API 테스트', exact: true }).click()
  await expect(page.getByRole('button', { name: '+ 새 시나리오', exact: true })).toBeEnabled()
  return {
    saves, requests, unexpected, globalSaves, chatMarks, terminalWrites, terminalStarts, chatSettingsSaves,
    get runs() { return runs }, get saveAttempts() { return saveAttempts },
    pause(environment: string) {
      gates.set(environment, new Promise<void>(resolve => releases.set(environment, resolve)))
    },
    resume(environment: string) {
      releases.get(environment)?.()
      gates.delete(environment)
      releases.delete(environment)
    },
    pauseSaving() { gates.set('scenario-save', new Promise<void>(resolve => releases.set('scenario-save', resolve))) },
    resumeSaving() { releases.get('scenario-save')?.(); gates.delete('scenario-save'); releases.delete('scenario-save') },
  }
}

/** A Claude terminal session started in dev. */
const terminalSession = (): ApiAiTerminal => ({ tool: 'claude', environmentId: environments.dev, running: true, buffer: 'Claude 대화 중' })
/** A checked result file with one draft; `issues` makes it need fixing. */
function checkedResult(issues: string[] = []) {
  const yaml = `id: ai-chat-draft\nname: 대화 조회\nserver: ${serverId}\nsteps:\n  - api: GET /dev-items\n`
  return { modifiedAt: importedAt, result: { drafts: [{ id: 'ai-chat-draft', name: '대화 조회', yaml, stepCount: 1, issues, executionIssues: [], notices: [] }], suite: null } }
}

test('the AI terminal checks the result file below the terminal; saving it is remembered for the session', async ({ page }) => {
  const state = await workspace(page, false, false, { chat: { current: terminalSession(), result: checkedResult() } })
  state.pauseSaving()
  await openAi(page, 'chat')
  const terminal = page.getByRole('region', { name: 'AI 터미널', exact: true })
  const check = terminal.getByRole('region', { name: 'AI 결과 검사', exact: true })
  await expect(terminal).toContainText('Claude 대화')
  await expect(terminal.locator('.xterm')).toBeVisible()
  await check.getByRole('button', { name: '선택한 것 저장', exact: true }).click()
  await expect.poll(() => state.saveAttempts).toBe(1)
  await expect(page.getByRole('tab', { name: '시나리오', exact: true })).toBeDisabled()
  state.resumeSaving()
  await expect.poll(() => state.chatMarks.length).toBe(1)
  expect(state.chatMarks[0]).toEqual([projectId, { modifiedAt: importedAt, scenarioId: 'ai-chat-draft' }])
  expect(state.saves[0].scope).toEqual({ projectId, environmentId: environments.dev })
  await expect(page.getByRole('tab', { name: '시나리오', exact: true })).toBeEnabled()
  await page.getByRole('tab', { name: '시나리오', exact: true }).click()
  await page.getByRole('tab', { name: 'AI 작성 도우미', exact: true }).click()
  // Already saved: the results panel stays closed, without a "저장 전" mark, until opened.
  await expect(check).toHaveCount(0)
  await terminal.getByRole('button', { name: '결과 열기', exact: true }).click()
  await expect(check.getByRole('status').filter({ hasText: '저장했습니다' })).toBeVisible()
  await expect(check.getByRole('button', { name: '선택한 것 저장', exact: true })).toHaveCount(0)
  expect(state.saves).toHaveLength(1)
  expect(state.unexpected).toEqual([])
})

test('problems in the result go back to the terminal as one pasted block; another environment keeps the session environment', async ({ page }) => {
  const state = await workspace(page, false, false, { chat: { current: terminalSession(), result: checkedResult(['API를 찾을 수 없습니다']) } })
  await page.getByRole('group', { name: 'API 환경', exact: true }).getByRole('button', { name: 'stage', exact: true }).click()
  await openAi(page, 'chat')
  const terminal = page.getByRole('region', { name: 'AI 터미널', exact: true })
  await expect(terminal).toContainText('이 대화는 dev에서 시작했습니다')
  await terminal.getByRole('button', { name: '문제를 AI에 보내기', exact: true }).click()
  await expect(terminal.getByRole('button', { name: 'AI에 보냈습니다', exact: true })).toBeDisabled()
  await expect.poll(() => state.terminalWrites.length).toBe(2)
  expect(state.terminalWrites[0]).toMatch(/^\x1b\[200~Checkly 검사에서 아래 문제가 나왔습니다[\s\S]*API를 찾을 수 없습니다[\s\S]*\x1b\[201~$/)
  expect(state.terminalWrites[1]).toBe('\r')
  // 대화 초기화 asks first (the result was not saved), then goes back to 대화 시작 in the current environment.
  const asked: string[] = []
  page.once('dialog', dialog => { asked.push(dialog.message()); void dialog.accept() })
  await terminal.getByRole('button', { name: '대화 초기화', exact: true }).click()
  await expect.poll(() => asked).toEqual(['저장하지 않은 결과가 사라집니다. 초기화할까요?'])
  await terminal.getByRole('button', { name: '대화 시작', exact: true }).click()
  await expect.poll(() => state.terminalStarts.length).toBe(1)
  expect((state.terminalStarts[0] as { scope: unknown }).scope).toEqual({ projectId, environmentId: environments.stage })
  await expect(terminal).not.toContainText('이 대화는 dev에서 시작했습니다')
  expect(state.unexpected).toEqual([])
})

test('AI chat settings fall back to an installed tool when the chosen one is missing', async ({ page }) => {
  const state = await workspace(page, false, false, { chat: { current: terminalSession(),
    settings: { folders: { [serverId]: ['/backend'] }, tool: 'codex' },
  } })
  await openAi(page, 'chat')
  // Only one AI is installed: nothing to choose, and nothing is saved.
  await expect(page.getByRole('region', { name: 'AI 터미널', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'AI 실행 설정', exact: true })).toHaveCount(0)
  expect(state.chatSettingsSaves).toEqual([])
  await page.getByRole('button', { name: '프로젝트 설정', exact: true }).click()
  await expect(page.locator('.api-project-form').getByLabel('모델 (선택)', { exact: true })).toHaveCount(0)
  await expect(page.locator('.api-project-form').getByLabel('사용할 AI', { exact: true })).toHaveCount(0)
  expect(state.unexpected).toEqual([])
})

test('the AI tab has two ways as tabs: chat needs an installed AI and a backend folder, set from the project form', async ({ page }) => {
  const state = await workspace(page, false, false, { chat: { current: null, settings: { folders: {} } } })
  await openAi(page)
  const author = page.getByRole('region', { name: 'AI 시나리오 작성', exact: true })
  const ways = author.getByRole('tablist', { name: '작성 방식', exact: true })
  const chatTab = ways.getByRole('tab', { name: '앱에서 AI와 대화', exact: true })
  const copyTab = ways.getByRole('tab', { name: '내 AI 앱에서 쓰기', exact: true })
  // Without a folder the copy-and-paste guide opens; the chat tab lists what it still needs.
  await expect(copyTab).toHaveAttribute('aria-selected', 'true')
  await expect(author.getByRole('button', { name: 'AI 가이드 복사', exact: true })).toBeVisible()
  await chatTab.click()
  const needs = author.getByRole('region', { name: '앱에서 AI와 대화 준비', exact: true })
  await expect(needs).toContainText('AIClaude')
  await expect(needs).toContainText('백엔드 코드 폴더없음')
  await expect(author.getByRole('button', { name: 'AI 가이드 복사', exact: true })).toHaveCount(0)
  await expect(author.getByRole('button', { name: '작성 방식 바꾸기', exact: true })).toHaveCount(0)
  state.pause('ai-settings')
  await needs.getByRole('button', { name: '설정하기', exact: true }).click()
  const form = page.locator('.api-project-form')
  await expect(form.getByRole('status')).toContainText('백엔드 폴더를 불러오는 중')
  state.resume('ai-settings')
  await expect(form.getByLabel('API 폴더 경로', { exact: true })).toBeFocused()
  await expect(form.getByLabel('API 폴더 경로', { exact: true })).toBeInViewport()
  await expect(form.getByRole('heading', { name: '백엔드 코드 폴더 (선택)', exact: true })).toBeVisible()
  await form.getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  await expect(needs).toContainText('백엔드 코드 폴더없음')
  expect(state.chatSettingsSaves.at(-1)?.folders).toEqual({ [serverId]: [] })
  await needs.getByRole('button', { name: '설정하기', exact: true }).click()
  // A path typed but not explicitly added is included in the project save.
  await form.getByLabel('API 폴더 경로', { exact: true }).fill('/backend')
  await form.getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  expect(state.chatSettingsSaves.at(-1)?.folders).toEqual({ [serverId]: ['/backend'] })
  await expect(author.getByRole('button', { name: '대화 시작', exact: true })).toBeEnabled()
  await expect(author.getByRole('button', { name: 'AI 가이드 복사', exact: true })).toHaveCount(0)
  // The other way is the other tab, remembered for the project.
  await copyTab.click()
  await expect(author.getByRole('button', { name: 'AI 가이드 복사', exact: true })).toBeVisible()
  await expect(author.getByRole('region', { name: 'AI 대화', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: '시나리오', exact: true }).click()
  await openAi(page)
  await expect(copyTab).toHaveAttribute('aria-selected', 'true')
  await chatTab.click()
  await page.getByRole('button', { name: '프로젝트 설정', exact: true }).click()
  await form.getByRole('button', { name: 'API 폴더 /backend 제거', exact: true }).click()
  await form.getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  await expect(needs).toContainText('백엔드 코드 폴더없음')
  expect(state.unexpected).toEqual([])
})

test('while a chat exists its AI is locked; changing it needs 대화 초기화 first', async ({ page }) => {
  const state = await workspace(page, false, false, { chat: { current: terminalSession(),
    settings: { folders: { [serverId]: ['/backend'] }, tool: 'codex' },
    tools: [{ tool: 'claude', version: 'claude-test' }, { tool: 'codex', version: 'codex-test' }],
  } })
  await openAi(page, 'chat')
  const choice = page.getByRole('radiogroup', { name: '사용할 AI', exact: true })
  // The chat runs on Claude even though Codex is chosen for the next start; a session cannot move between CLIs.
  await expect(choice.getByRole('radio', { name: 'Claude', exact: true })).toBeChecked()
  await expect(choice.getByRole('radio', { name: 'Codex', exact: true })).toBeDisabled()
  await expect(choice).toContainText('바꾸려면 대화 초기화')
  await expect(page.getByRole('button', { name: 'AI 다시 확인', exact: true })).toHaveCount(0)
  expect(state.chatSettingsSaves).toEqual([])
  expect(state.unexpected).toEqual([])
})

test('AI project settings discard picked folders when leaving without saving', async ({ page }) => {
  const state = await workspace(page, false, false, { chat: { current: null, settings: { folders: {} } } })
  await openAi(page, 'chat')
  await page.getByRole('button', { name: '설정하기', exact: true }).click()
  const form = page.locator('.api-project-form')
  await form.getByRole('button', { name: '폴더 선택…', exact: true }).click()
  await expect(form).toContainText('/backend/a')
  await expect(form).toContainText('/backend/b')
  await form.getByRole('button', { name: '← 돌아가기', exact: true }).click()
  await page.getByRole('button', { name: '변경사항 버리고 나가기', exact: true }).click()
  await expect(page.getByRole('region', { name: '앱에서 AI와 대화 준비', exact: true })).toContainText('백엔드 코드 폴더없음')
  expect(state.chatSettingsSaves).toEqual([])
  expect(state.unexpected).toEqual([])
})

test('AI authoring checks the installed AI (refresh is an icon) and the chat picks the AI with radio buttons', async ({ page }) => {
  const state = await workspace(page, false, false, { chat: { current: null, settings: { folders: { [serverId]: ['/backend'] }, tool: 'claude' },
    tools: [{ tool: 'claude', version: 'claude-test' }, { tool: 'codex', version: 'codex-test' }],
  } })
  state.pause('ai-status')
  await openAi(page)
  await expect(page.getByRole('status').filter({ hasText: '설치된 AI를 확인하는 중' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: '작성 방식', exact: true })).toHaveCount(0)
  state.resume('ai-status')
  // Ready (AI and folder): the chat tab opens with the AI choice and a refresh icon on the tabs row.
  await expect(page.getByRole('tab', { name: '앱에서 AI와 대화', exact: true })).toHaveAttribute('aria-selected', 'true')
  const choice = page.getByRole('radiogroup', { name: '사용할 AI', exact: true })
  await expect(choice).toContainText('AIClaudeCodex')
  state.pause('ai-status')
  await page.getByRole('button', { name: 'AI 다시 확인', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '설치된 AI를 확인하는 중' })).toBeVisible()
  state.resume('ai-status')
  await expect(choice.getByRole('radio', { name: 'Claude', exact: true })).toBeChecked()
  await choice.getByRole('radio', { name: 'Codex', exact: true }).check()
  // Picking saves right away; there is no save button or effort choice.
  await expect.poll(() => state.chatSettingsSaves.at(-1)).toEqual({ folders: { [serverId]: ['/backend'] }, tool: 'codex' })
  await expect(choice.getByRole('radio', { name: 'Codex', exact: true })).toBeChecked()
  await expect(page.getByRole('button', { name: 'AI 설정 저장', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('추론 수준', { exact: true })).toHaveCount(0)
  expect(state.unexpected).toEqual([])
})

test('AI project settings remain wheel scrollable after focusing a folder in a short window', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 })
  const state = await workspace(page, false, false, { chat: { current: null, settings: { folders: {} } } })
  await openAi(page, 'chat')
  await page.getByRole('button', { name: '설정하기', exact: true }).click()
  const form = page.locator('.api-project-form')
  const input = form.getByLabel('API 폴더 경로', { exact: true })
  await expect(input).toBeFocused()
  await expect(input).toBeInViewport()
  const host = page.locator('.content')
  const start = await host.evaluate(element => element.scrollTop)
  expect(start).toBeGreaterThan(0)
  const box = await input.boundingBox()
  await page.mouse.move(box!.x + 10, box!.y + 10)
  await page.mouse.wheel(0, -2000)
  await expect.poll(() => host.evaluate(element => element.scrollTop)).toBeLessThan(start)
  await expect(form.getByRole('heading', { name: '프로젝트 설정', exact: true })).toBeInViewport()
  await page.mouse.wheel(0, 2000)
  await expect(input).toBeInViewport()
  const inputBox = await input.boundingBox()
  const footerBox = await form.locator('footer').boundingBox()
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(footerBox!.y)
  await expect(form.getByRole('button', { name: '프로젝트 저장', exact: true })).toBeInViewport()
  expect(state.unexpected).toEqual([])
})

/** Opens the AI tab and, when given, picks the way on its first step. */
async function openAi(page: Page, way?: 'chat' | 'copy') {
  await page.getByRole('tab', { name: 'AI 작성 도우미', exact: true }).click()
  if (way) await page.getByRole('tab', { name: way === 'chat' ? '앱에서 AI와 대화' : '내 AI 앱에서 쓰기', exact: true }).click()
}

const editStep = (page: Page) => page.getByRole('navigation', { name: '시나리오 작성 단계' }).getByRole('button', { name: /값 설정/ })
const selectStep = (page: Page) => page.getByRole('navigation', { name: '시나리오 작성 단계' }).getByRole('button', { name: /API 선택/ })
const environment = (page: Page, name: string) => page.getByRole('group', { name: '시나리오 전체 호출 환경' }).getByRole('button', { name, exact: true })
const stepDetails = (page: Page) => page.locator('details[aria-label="편집 단계 1"]')

async function setDraft(page: Page, name: string) {
  await editStep(page).click()
  await page.getByLabel('시나리오 이름', { exact: true }).fill(name)
  await page.getByLabel('시나리오 설명', { exact: true }).fill('환경을 바꾸어도 유지할 설명')
  await page.getByRole('button', { name: '새 그룹 폴더 만들기', exact: true }).click()
  const folder = page.getByRole('group', { name: '새 그룹 폴더 만들기', exact: true })
  await folder.getByLabel('상위 폴더').selectOption('')
  await folder.getByLabel('폴더 이름').fill(groupPath[0])
  await folder.getByRole('button', { name: '만들기', exact: true }).click()
  await stepDetails(page).locator('summary').first().click()
  await page.getByLabel('1단계 q', { exact: true }).fill('edited-query')
}

async function expectDraft(page: Page, name: string) {
  await expect(page.getByLabel('시나리오 이름', { exact: true })).toHaveValue(name)
  await expect(page.getByLabel('시나리오 설명', { exact: true })).toHaveValue('환경을 바꾸어도 유지할 설명')
  await expect(page.getByRole('combobox', { name: '그룹', exact: true })).toHaveValue(JSON.stringify(groupPath))
  await expect(editStep(page)).toHaveAttribute('aria-current', 'step')
  await expect(stepDetails(page)).toHaveAttribute('open', '')
  await expect(stepDetails(page).locator('summary').first()).toContainText('/dev-items')
}

for (const existing of [false, true]) {
  test(`${existing ? 'saved scenario edits' : 'new scenario draft'} survive an environment without a catalog`, async ({ page }) => {
    const fixture = await workspace(page)
    if (existing) {
      await page.getByRole('button', { name: '저장된 시나리오', exact: true }).click()
      await page.getByRole('button', { name: '수정', exact: true }).click()
    } else {
      await page.getByRole('button', { name: '+ 새 시나리오', exact: true }).click()
      await page.getByRole('button', { name: '시나리오에 API 추가', exact: true }).click()
    }
    const name = existing ? '수정 중 시나리오' : '새 시나리오 초안'
    await setDraft(page, name)
    await environment(page, 'empty').click()
    await expect(environment(page, 'empty')).toHaveAttribute('aria-pressed', 'true')
    await expectDraft(page, name)
    await expect(stepDetails(page)).toContainText('이 환경에는 가져온 명세가 없습니다')
    // Dirty tracking must survive too, so returning to the list still asks before discarding.
    await page.getByRole('button', { name: '시나리오 목록으로', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '저장하지 않은 변경사항' })).toBeVisible()
    await page.getByRole('button', { name: '계속 작성', exact: true }).click()
    await environment(page, 'dev').click()
    await expectDraft(page, name)
    await expect(page.getByLabel('1단계 q', { exact: true })).toHaveValue('edited-query')
    await page.getByRole('button', { name: '시나리오 검사·저장', exact: true }).click()
    await expect.poll(() => fixture.saves.length).toBe(1)
    const { item, scope } = fixture.saves[0]
    const scenario = parseScenario(item.source)
    expect(item.id === 'stored-scenario').toBe(existing)
    expect(item.draft).toBe(false)
    expect(item.groupPath).toEqual(groupPath)
    expect(scope.environmentId).toBe(environments.dev)
    expect(scenario.name).toBe(name)
    expect(scenario.description).toBe('환경을 바꾸어도 유지할 설명')
    expect(scenario.steps).toHaveLength(1)
    expect(scenario.steps[0].request.query).toEqual({ q: 'edited-query' })
    expect(fixture.unexpected).toEqual([])
  })
}

test('catalog loading and failures never display the previous environment catalog', async ({ page }) => {
  const fixture = await workspace(page)
  await page.getByRole('button', { name: '+ 새 시나리오', exact: true }).click()
  await page.getByRole('button', { name: '시나리오에 API 추가', exact: true }).click()
  await setDraft(page, '명세 조회 중에도 유지')
  await selectStep(page).click()
  const swagger = page.locator('.api-swagger-renderer')
  await expect(swagger.locator('.opblock')).toContainText('/dev-items')
  fixture.pause(environments.stage)
  try {
    await environment(page, 'stage').click()
    await expect.poll(() => fixture.requests.filter(id => id === environments.stage).length).toBeGreaterThan(0)
    await expect(swagger.locator('.opblock')).toHaveCount(0)
    await expect(selectStep(page)).toHaveAttribute('aria-current', 'step')
    await expect(page.getByRole('button', { name: '시나리오 목록으로', exact: true })).toBeVisible()
  } finally {
    fixture.resume(environments.stage)
  }
  // Both catalogs deliberately share importedAt; environment identity must distinguish them.
  await expect(swagger.locator('.opblock')).toContainText('/stage-items')
  await expect(swagger.locator('.opblock')).not.toContainText('/dev-items')
  await environment(page, 'broken').click()
  await expect(environment(page, 'broken')).toHaveAttribute('aria-pressed', 'true')
  await expect(swagger.locator('.opblock')).toHaveCount(0)
  await editStep(page).click()
  await expectDraft(page, '명세 조회 중에도 유지')
  await environment(page, 'dev').click()
  await expect(page.getByLabel('1단계 q', { exact: true })).toHaveValue('edited-query')
  await selectStep(page).click()
  await expect(swagger.locator('.opblock')).toContainText('/dev-items')
  await expect(swagger.locator('.opblock')).not.toContainText('/stage-items')
  expect(fixture.unexpected).toEqual([])
})

test('unfinished array and body JSON retain their text and validity across environment changes', async ({ page }) => {
  const fixture = await workspace(page, true)
  await page.getByRole('button', { name: '+ 새 시나리오', exact: true }).click()
  const structuredApi = page.locator('.api-swagger-renderer .opblock').filter({ hasText: '/structured' })
  await structuredApi.getByRole('button', { name: '시나리오에 API 추가', exact: true }).click()
  await editStep(page).click()
  await page.getByLabel('시나리오 이름', { exact: true }).fill('미완성 JSON 보존')
  await stepDetails(page).locator('summary').first().click()
  const filters = page.getByLabel('1단계 filters JSON', { exact: true })
  const body = page.getByLabel('시나리오 요청 본문 JSON', { exact: true })
  const save = page.getByRole('button', { name: '시나리오 검사·저장', exact: true })
  // Establish previous valid model values before leaving unfinished text in each editor.
  await filters.fill('[1]')
  await body.fill('{"key":"initial"}')
  await filters.fill('[1,')
  await body.fill('{"key":')
  const expectUnfinished = async () => {
    await expect(filters).toHaveValue('[1,')
    await expect(body).toHaveValue('{"key":')
    expect(await filters.evaluate(element => (element as HTMLTextAreaElement).validity.customError)).toBe(true)
    expect(await body.evaluate(element => (element as HTMLTextAreaElement).validity.customError)).toBe(true)
    await expect(editStep(page)).toHaveAttribute('aria-current', 'step')
    await expect(stepDetails(page)).toHaveAttribute('open', '')
    await save.click()
    await expect(filters).toBeFocused()
    expect(fixture.saves).toHaveLength(0)
  }
  await expectUnfinished()
  // The second environment defines the same method/path and fields; only its catalog changes.
  fixture.pause(environments.stage)
  try {
    await environment(page, 'stage').click()
    await expect.poll(() => fixture.requests.filter(id => id === environments.stage).length).toBeGreaterThan(0)
    await expect(stepDetails(page)).toContainText('명세를 불러오는 중…')
    await expect(stepDetails(page)).not.toContainText(/명세에 없는 API입니다|가져온 명세가 없습니다/)
    await expect(page.getByRole('button', { name: '1단계 API 바꾸기', exact: true })).toBeDisabled()
    await expectUnfinished()
  } finally {
    fixture.resume(environments.stage)
  }
  await expect(structuredApi).toContainText('스테이징 구조 입력')
  await expect(stepDetails(page)).not.toContainText('명세를 불러오는 중…')
  await expect(page.getByRole('button', { name: '1단계 API 바꾸기', exact: true })).toBeEnabled()
  await expectUnfinished()
  await environment(page, 'empty').click()
  await expect(stepDetails(page)).toContainText('이 환경에는 가져온 명세가 없습니다')
  await expectUnfinished()
  await environment(page, 'dev').click()
  await expect(structuredApi).toContainText('개발 구조 입력')
  await expectUnfinished()
  // Fixing one field must not clear the other field's validation error.
  await filters.fill('[1, 2]')
  await save.click()
  await expect(body).toBeFocused()
  expect(fixture.saves).toHaveLength(0)
  await body.fill('{"key":"completed"}')
  await save.click()
  await expect.poll(() => fixture.saves.length).toBe(1)
  const saved = fixture.saves[0]
  const scenario = parseScenario(saved.item.source)
  expect(saved.scope.environmentId).toBe(environments.dev)
  expect(saved.item.draft).toBe(false)
  expect(scenario.steps[0].request.query).toEqual({ filters: [1, 2] })
  expect(scenario.steps[0].request.body).toEqual({ key: 'completed' })
  // A different endpoint must replace the retained field definition, including on a later empty environment.
  await page.getByRole('button', { name: '1단계 API 바꾸기', exact: true }).click()
  await page.getByRole('dialog', { name: '1단계 API 바꾸기', exact: true }).getByRole('button', { name: /GET.*\/replacement/ }).click()
  await expect(page.getByLabel('1단계 q', { exact: true })).toBeVisible()
  await environment(page, 'empty').click()
  await expect(stepDetails(page)).toContainText('이 환경에는 가져온 명세가 없습니다')
  await expect(page.getByLabel('1단계 q', { exact: true })).toBeVisible()
  await expect(filters).toHaveCount(0)
  await expect(body).toHaveCount(0)
  expect(fixture.unexpected).toEqual([])
})


test('global setup callbacks refresh the editor, summary and authentication choices', async ({ page }) => {
  const fixture = await workspace(page, false, true)
  await page.getByRole('button', { name: '저장된 시나리오', exact: true }).click()
  await page.getByRole('button', { name: '수정', exact: true }).click()
  await editStep(page).click()
  await stepDetails(page).locator('summary').first().click()
  const summaryLink = page.locator('.api-settings-summary').getByRole('button', { name: 'accessToken 전역변수 설정하기', exact: true })
  const editorLink = stepDetails(page).getByRole('button', { name: 'accessToken 전역변수 설정하기', exact: true })
  await expect(summaryLink).toBeVisible()
  await editorLink.click()
  const menu = page.getByRole('dialog', { name: '{ } 전역변수', exact: true })
  await expect(menu.getByLabel('전역변수 이름', { exact: true })).toHaveValue('accessToken')
  await menu.getByRole('button', { name: '{ } 전역변수 닫기', exact: true }).click()
  await summaryLink.click()
  await expect(menu.getByLabel('전역변수 이름', { exact: true })).toHaveValue('accessToken')
  await menu.getByLabel('전역변수 값', { exact: true }).fill('saved-token')
  await menu.getByRole('button', { name: '전역변수 저장', exact: true }).click()
  await expect.poll(() => fixture.globalSaves.length).toBe(1)
  expect(fixture.globalSaves[0]).toEqual([{ projectId }, 'accessToken', 'saved-token'])
  await expect(summaryLink).toHaveCount(0)
  await expect(editorLink).toHaveCount(0)
  await menu.getByRole('button', { name: '+ 변수 추가', exact: true }).click()
  await menu.getByLabel('전역변수 이름', { exact: true }).fill('otherToken')
  await menu.getByLabel('전역변수 값', { exact: true }).fill('another-token')
  await menu.getByRole('button', { name: '전역변수 저장', exact: true }).click()
  await expect(page.getByLabel('시나리오 기본 인증', { exact: true }).locator('option[value="globals.otherToken"]')).toHaveCount(1)
  expect(fixture.unexpected).toEqual([])
})

test('the header lists the project servers in their step-tag colours, only when there are two or more', async ({ page }) => {
  const fixture = await workspace(page, false, false, { twoServers: true })
  const legend = page.getByLabel('프로젝트 서버', { exact: true })
  await expect(legend).toContainText('서버')
  await expect(legend.locator('.api-run-server')).toHaveText(['API', '인증'])
  // Each tag keeps the server's colour and tells where it calls in the current environment.
  await expect(legend.locator('.api-run-server').nth(0)).toHaveClass(/api-server-tone-0/)
  await expect(legend.locator('.api-run-server').nth(1)).toHaveClass(/api-server-tone-1/)
  await expect(legend.locator('.api-run-server').nth(1)).toHaveAttribute('title', '인증 서버 · dev https://auth-dev.example.invalid')
  expect(fixture.unexpected).toEqual([])
})

test('a global missing in several steps is one line with links to those steps', async ({ page }) => {
  const twice = parseScenario(`id: token-twice\nname: 토큰 두 번 사용\nserver: ${serverId}\nsteps:\n  - { name: 첫 조회, api: GET /dev-items, query: { q: '{{globals.accessToken}}' } }\n  - { name: 둘째 조회, api: GET /dev-items, query: { q: '{{globals.accessToken}}' } }\n  - { name: 셋째 조회, api: GET /dev-items, query: { q: '{{globals.itemId}}' } }\n`)
  const fixture = await workspace(page, false, false, { missingGlobals: true, extra: [{ id: twice.id, name: twice.name, source: stringifyScenario(twice, true), bindings: {}, updatedAt: importedAt }] })
  await page.getByRole('button', { name: '토큰 두 번 사용', exact: true }).click()
  const readiness = page.getByRole('region', { name: '시나리오 실행 준비' }).getByRole('alert')
  await expect(readiness.locator('li')).toHaveCount(2)
  await expect(readiness.locator('li').nth(0)).toContainText('accessToken 값 없음 · 1·2단계')
  await expect(readiness.locator('li').nth(1)).toContainText('itemId 값 없음 · 3단계')
  await expect(readiness.getByRole('button', { name: 'accessToken 전역변수 설정하기', exact: true })).toBeVisible()
  // A step number opens that step in the run flow.
  await readiness.getByRole('button', { name: '2단계로 이동', exact: true }).click()
  await expect(page.locator('details.api-run-step').nth(1)).toHaveAttribute('open', '')
  expect(fixture.unexpected).toEqual([])
})


test('the AI API picker puts servers first, so the same tag and path on two servers stay apart', async ({ page }) => {
  // Both servers get the same catalog here: one tag and one path on each.
  const fixture = await workspace(page, false, false, { twoServers: true })
  await openAi(page, 'copy')
  await page.getByText(/^AI가 쓸 API/).click()
  const servers = page.locator('.api-picker-server')
  await expect(servers.locator('> summary')).toHaveText(['API1', '인증1'])
  await servers.nth(1).locator('> summary').click()
  await expect(servers.nth(1).locator('.api-picker-group > summary')).toHaveText('조회1')
  // A server's box picks only that server's APIs.
  await page.getByLabel('인증 서버 전체 선택', { exact: true }).check()
  await expect(servers.nth(1).locator('> summary small')).toHaveText('1/1')
  await expect(servers.nth(0).locator('> summary small')).toHaveText('1')
  await expect(page.getByText(/^AI가 쓸 API/)).toContainText('1개 선택')
  // The server name is searchable with the other words.
  await page.getByLabel('API 검색', { exact: true }).fill('인증 dev-items')
  await expect(servers).toHaveCount(1)
  await expect(servers.locator('> summary')).toContainText('인증')
  expect(fixture.unexpected).toEqual([])
})

test('run results show bodies first with headers folded, and a skipped step as one line', async ({ page }) => {
  const three = parseScenario(`id: three-steps\nname: 세 단계\nserver: ${serverId}\nsteps:\n  - { name: 첫째, api: GET /dev-items }\n  - { name: 둘째, api: GET /dev-items }\n  - { name: 셋째, api: GET /dev-items }\n`)
  const fixture = await workspace(page, false, false, { failSecondStep: true, extra: [{ id: three.id, name: three.name, source: stringifyScenario(three, true), bindings: {}, updatedAt: importedAt }] })
  await page.getByRole('button', { name: '세 단계', exact: true }).click()
  await page.getByRole('button', { name: '실행', exact: true }).click()
  const result = page.getByRole('region', { name: '시나리오 실행 결과' })
  await result.getByRole('button', { name: '모두 펼치기', exact: true }).click()
  const steps = result.locator('.api-run-result-step')
  // The response body is shown as is (no "body"/"headers" wrapper); headers are folded with their count.
  await expect(steps.nth(0).locator('.api-run-payload').nth(1)).toContainText('"ok": true')
  await expect(steps.nth(0).locator('.api-run-payload').nth(1)).not.toContainText('"body"')
  const responseHeaders = steps.nth(0).locator('.api-run-payload').nth(1).locator('.api-run-headers')
  await expect(responseHeaders.locator('summary')).toHaveText('헤더 2개')
  await expect(responseHeaders).not.toHaveAttribute('open', '')
  await expect(steps.nth(0).locator('.api-run-payload').nth(0).locator('.api-run-headers summary')).toHaveText('헤더 1개')
  // Skipped: one line, no empty request/response boxes, no "0ms".
  await expect(steps.nth(2).locator('.api-run-result-step-body')).toHaveText('앞 단계가 실패해 이 단계는 실행하지 않았습니다.')
  await expect(steps.nth(2).locator('.api-run-result-duration')).toHaveCount(0)
  expect(fixture.unexpected).toEqual([])
})

test('narrow windows fold the settings summary so the step editor keeps the height', async ({ page }) => {
  const fixture = await workspace(page)
  await page.getByRole('button', { name: '저장된 시나리오', exact: true }).click()
  await page.getByRole('button', { name: '수정', exact: true }).click()
  await editStep(page).click()
  const toggle = page.getByRole('button', { name: /^설정 요약 (보기|접기)$/ })
  await expect(toggle).toBeHidden()
  await page.setViewportSize({ width: 880, height: 700 })
  await expect(toggle).toHaveText('설정 요약 보기')
  await expect(page.locator('.api-settings-summary .api-summary-card').first()).toBeHidden()
  await toggle.click()
  await expect(toggle).toHaveText('설정 요약 접기')
  await expect(page.locator('.api-settings-summary .api-summary-card').first()).toBeVisible()
  expect(fixture.unexpected).toEqual([])
})

test('with no spec, the composer links to API 문서 and the AI tab cannot be opened', async ({ page }) => {
  const fixture = await workspace(page)
  await page.getByRole('group', { name: 'API 환경' }).getByRole('button', { name: 'empty', exact: true }).click()
  await page.getByRole('button', { name: '+ 새 시나리오', exact: true }).click()
  await page.getByRole('button', { name: 'API 문서로 이동', exact: true }).click()
  await expect(page.getByRole('tab', { name: /^API 문서/ })).toHaveAttribute('aria-selected', 'true')
  const aiTab = page.getByRole('tab', { name: 'AI 작성 도우미', exact: true })
  await expect(aiTab).toBeDisabled()
  await expect(aiTab).toHaveAttribute('title', /API 명세가 없습니다/)
  // Another environment with a spec opens it again.
  await page.getByRole('tab', { name: '시나리오', exact: true }).click()
  await page.getByRole('group', { name: 'API 환경' }).getByRole('button', { name: 'dev', exact: true }).click()
  await expect(aiTab).toBeEnabled()
  expect(fixture.unexpected).toEqual([])
})

test('a run the user stopped is a plain note, not a problem alert', async ({ page }) => {
  const fixture = await workspace(page, false, false, { cancelRun: true })
  await page.getByRole('button', { name: '저장된 시나리오', exact: true }).click()
  await page.getByRole('button', { name: '실행', exact: true }).click()
  const summary = page.getByRole('region', { name: '시나리오 실행 준비' })
  await expect(summary.getByRole('status')).toHaveText('실행을 중단했습니다. 다시 실행하려면 다시 실행을 누르세요.')
  await expect(summary.locator('.api-run-last-problem')).toHaveCount(0)
  expect(fixture.unexpected).toEqual([])
})

test('the server legend stays off the project form, and an unsavable suite says why', async ({ page }) => {
  const fixture = await workspace(page, false, false, { twoServers: true })
  await expect(page.getByLabel('프로젝트 서버', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '프로젝트 설정', exact: true }).click()
  await expect(page.getByLabel('프로젝트 서버', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '← 돌아가기', exact: true }).click()
  await page.getByRole('button', { name: '+ 새 스위트', exact: true }).click()
  const hint = page.locator('.api-suite-save-hint')
  await expect(hint).toHaveText('이름을 적고 시나리오를 추가하면 저장할 수 있습니다.')
  await page.getByLabel('스위트 이름', { exact: true }).fill('묶음')
  await expect(hint).toHaveText('시나리오를 하나 이상 추가하세요.')
  await page.getByRole('combobox', { name: /^시나리오 추가/ }).selectOption({ label: '저장된 시나리오' })
  await expect(hint).toHaveCount(0)
  await expect(page.getByRole('button', { name: '스위트 저장', exact: true })).toBeEnabled()
  expect(fixture.unexpected).toEqual([])
})
