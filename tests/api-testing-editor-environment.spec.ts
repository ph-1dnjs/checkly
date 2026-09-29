import { expect, test, type Page } from '@playwright/test'
import { parseScenario, stringifyScenario } from '../src/app/api-testing/shared/scenario'
import type { ApiCatalog, ApiEnvironmentScope, ApiProject, ApiScenarioPreview, ApiScope, ApiTestingBridge, SavedApiScenario } from '../src/app/api-testing/shared/workspace'

const projectId = '00000000-0000-4000-8000-000000000001'
const serverId = '00000000-0000-4000-8000-000000000002'
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

async function workspace(page: Page, structured = false) {
  const catalogs: Record<string, ApiCatalog | null> = {
    [environments.dev]: structured ? structuredCatalog('개발 구조 입력') : catalog('/dev-items', '개발 환경 조회'),
    [environments.empty]: null,
    [environments.stage]: structured ? structuredCatalog('스테이징 구조 입력') : catalog('/stage-items', '스테이징 환경 조회'),
  }
  const project: ApiProject = {
    id: projectId, name: '환경 전환 회귀', servers: [{ id: serverId, name: 'API' }],
    environments: Object.entries(environments).map(([name, id]) => ({
      id, name, baseUrls: { [serverId]: `https://${name}.example.invalid` },
    })),
  }
  const original = parseScenario(`id: stored-scenario\nname: 저장된 시나리오\ndescription: 저장된 설명\nserver: ${serverId}\nsteps:\n  - api: GET /dev-items\n    query: { q: original }\n`)
  let saved: SavedApiScenario[] = [{
    id: original.id, name: original.name, source: stringifyScenario(original, true),
    bindings: {}, updatedAt: importedAt, groupPath: ['기존 그룹'],
  }]
  const saves: Array<{ scope: ApiEnvironmentScope; item: SavedApiScenario }> = []
  const requests: string[] = []
  const unexpected: string[] = []
  const gates = new Map<string, Promise<void>>()
  const releases = new Map<string, () => void>()
  const preview = (scope: ApiEnvironmentScope, source: string): ApiScenarioPreview => {
    const scenario = parseScenario(source)
    const operations = catalogs[scope.environmentId]?.operations ?? []
    const issues = scenario.steps.flatMap(step => operations.some(operation => 'method' in step.api && operation.method === step.api.method && operation.path === step.api.path)
      ? [] : [`${step.name ?? step.id}: 현재 환경의 명세에서 API를 찾을 수 없습니다`])
    return { scenario, issues, executionIssues: [] }
  }
  await page.exposeFunction('__apiTestingCall', async (method: string, args: unknown[]) => {
    switch (method) {
      case 'listProjects': return [project]
      case 'listScenarios': return saved
      case 'listSuites':
      case 'listGlobals':
      case 'listCookies': return []
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
      apiTesting: new Proxy({}, { get: (_target, method: string) => (...args: unknown[]) => call(method, args) }),
    } })
  })
  await page.goto(`/?tab=scenarios&project=${projectId}&server=${serverId}&environment=${environments.dev}`)
  await page.getByRole('button', { name: 'API 테스트', exact: true }).click()
  await expect(page.getByRole('button', { name: '+ 새 시나리오', exact: true })).toBeEnabled()
  return {
    saves, requests, unexpected,
    pause(environment: string) {
      gates.set(environment, new Promise<void>(resolve => releases.set(environment, resolve)))
    },
    resume(environment: string) {
      releases.get(environment)?.()
      gates.delete(environment)
      releases.delete(environment)
    },
  }
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
    await expect(stepDetails(page)).toContainText('현재 API 명세에서 이 API를 찾을 수 없습니다')
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
    await expectUnfinished()
  } finally {
    fixture.resume(environments.stage)
  }
  await expect(structuredApi).toContainText('스테이징 구조 입력')
  await expectUnfinished()
  await environment(page, 'empty').click()
  await expect(stepDetails(page)).toContainText('현재 API 명세에서 이 API를 찾을 수 없습니다')
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
  await expect(stepDetails(page)).toContainText('현재 API 명세에서 이 API를 찾을 수 없습니다')
  await expect(page.getByLabel('1단계 q', { exact: true })).toBeVisible()
  await expect(filters).toHaveCount(0)
  await expect(body).toHaveCount(0)
  expect(fixture.unexpected).toEqual([])
})
