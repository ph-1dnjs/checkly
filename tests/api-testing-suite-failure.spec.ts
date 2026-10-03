import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ApiWorkspace } from '../src/app/api-testing/main/workspace'

// The screen uses the real workspace and HTTP runner; only native IPC/file dialogs are replaced.
async function withFailedLogin(page: Page, onFailure: 'stop' | 'continue', check: (fixture: { calls: string[]; reportFile: string }) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'checkly-suite-failure-'))
  const calls: string[] = []
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`)
    response.setHeader('content-type', 'application/json')
    if (request.url === '/login') {
      response.writeHead(401).end(JSON.stringify({ message: 'server-response-secret' }))
    } else {
      response.end(JSON.stringify({ ok: true, authorization: request.headers.authorization }))
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const workspace = new ApiWorkspace(directory)
    const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID()
    const scope = { projectId, serverId, environmentId }
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    await workspace.saveProject({ id: projectId, name: '스위트 실패 회귀', servers: [{ id: serverId, name: 'API' }], environments: [{ id: environmentId, name: 'local', baseUrls: { [serverId]: baseUrl } }] })
    await workspace.importSpec(scope, JSON.stringify({ openapi: '3.0.3', info: { title: '회귀 API', version: '1' }, paths: {
      '/login': { post: { responses: { '200': { description: '로그인' }, '401': { description: '인증 실패' } } } },
      '/private': { get: { responses: { '200': { description: '인증 조회' } } } },
      '/health': { get: { responses: { '200': { description: '상태 확인' } } } },
    } }))
    await workspace.setGlobal({ projectId }, 'accessToken', 'stale-suite-token')
    for (const source of [
      'id: login\nname: 로그인\nserver: API\nsteps:\n  - api: POST /login\n    extract: [{ pointer: /token, target: globals.accessToken }]\n',
      'id: private\nname: 인증 조회\nserver: API\nauth: globals.accessToken\nsteps:\n  - api: GET /private\n',
      'id: health\nname: 독립 상태 확인\nserver: API\nsteps:\n  - api: GET /health\n',
    ]) await workspace.saveScenario({ projectId, environmentId }, source, {})
    await workspace.saveSuite(projectId, { id: randomUUID(), name: '로그인 실패 스위트', scenarioIds: ['login', 'private', 'health'], onFailure })
    const reportFile = path.join(directory, 'report.html')
    const allowed = new Set(['listProjects', 'listScenarios', 'listSuites', 'listGlobals', 'listCookies', 'getRequestAuth', 'getCatalog', 'previewScenario', 'runScenario', 'checkScenarioSpecs'])
    await page.exposeFunction('__suiteTestingCall', async (method: string, args: unknown[]) => {
      if (method === 'getSpecSync') return { hasSavedAccount: false, secureStorageAvailable: false }
      if (method === 'getPendingScenarioInput') return null
      if (method === 'saveSuiteReport') {
        await writeFile(reportFile, args[1] as string, 'utf8')
        return reportFile
      }
      if (!allowed.has(method)) throw new Error(`Unexpected bridge call: ${method}`)
      const action = workspace[method as keyof ApiWorkspace] as (...values: unknown[]) => unknown
      return action.apply(workspace, args)
    })
    await page.addInitScript(() => {
      const call = (window as unknown as { __suiteTestingCall: (method: string, args: unknown[]) => Promise<unknown> }).__suiteTestingCall
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
    await page.goto(`/?tab=scenarios&project=${projectId}&server=${serverId}&environment=${environmentId}`)
    await page.getByRole('button', { name: 'API 테스트', exact: true }).click()
    await page.getByRole('button', { name: '로그인 실패 스위트', exact: true }).click()
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await expect(page.getByRole('region', { name: '스위트 실행 결과' })).toContainText('실행 결과 · 실패')
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeEnabled()
    await check({ calls, reportFile })
  } finally {
    await page.goto('about:blank').catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

for (const onFailure of ['stop', 'continue'] as const) {
  test(`suite ${onFailure}: a failed login never reuses an old token, and the report matches the screen`, async ({ page }) => {
    await withFailedLogin(page, onFailure, async ({ calls, reportFile }) => {
      const result = page.getByRole('region', { name: '스위트 실행 결과' })
      const statuses = onFailure === 'stop' ? ['실패', '건너뜀', '건너뜀'] : ['실패', '설정 필요', '통과']
      await expect(result.locator('summary .api-run-result-status')).toHaveText(statuses)
      expect(calls).toEqual(onFailure === 'stop' ? ['POST /login'] : ['POST /login', 'GET /health'])
      if (onFailure === 'continue') await expect(result).toContainText('앞 시나리오의 전역변수 생성 실패로 실행하지 않았습니다.')
      await result.getByRole('button', { name: 'HTML 리포트 받기', exact: true }).click()
      await expect.poll(() => readFile(reportFile, 'utf8').catch(() => '')).toContain('<!doctype html>')
      const html = await readFile(reportFile, 'utf8')
      expect(html).not.toMatch(/stale-suite-token|server-response-secret|Authorization|Bearer/)
      const report = await page.context().newPage()
      try {
        await report.setContent(html)
        await expect(report.locator('.scenario-head .status')).toHaveText(statuses)
        await expect(report.getByRole('heading', { name: '로그인 실패 스위트', exact: true })).toBeVisible()
        await expect(report.getByRole('heading', { name: '확인이 필요한 항목', exact: true })).toBeVisible()
      } finally { await report.close() }
    })
  })
}
