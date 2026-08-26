import 'dotenv/config'

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Video } from '@playwright/test'

type QaStep = { id: string; action: 'goto' | 'fill' | 'fileUpload' | 'manualFill' | 'manualResult' | 'click' | 'select' | 'expectText'; target: string; value?: string; required?: boolean; prompt?: string; condition?: string; waitSeconds?: number; occurrence?: number }
type QaScenario = { title: string; url: string; steps: QaStep[] }
type QaRunOptions = { preview?: boolean; workerId?: string }
type ManualResult = { status: 'passed' | 'failed'; reason?: string }
let activeRun: { browser?: Browser; resolveManual?: (value: string | null) => void; resolveManualResult?: (value: ManualResult) => void; cancelled: boolean } | null = null
let activeScenarioFilePath: string | null = null
let scenarioWorker: { id: string; browser: Browser; context: BrowserContext } | null = null

const closeScenarioWorker = async (workerId?: string): Promise<void> => {
  if (!scenarioWorker || (workerId && scenarioWorker.id !== workerId)) return
  const worker = scenarioWorker
  scenarioWorker = null
  try { await worker.context.close() } catch { /* 이미 종료된 컨텍스트는 무시한다. */ }
  try { await worker.browser.close() } catch { /* 이미 종료된 브라우저는 무시한다. */ }
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const writeRunReport = async (scenario: QaScenario, status: string, log: string[]): Promise<string> => {
  const runId = `run-${Date.now()}`
  const directory = path.join(app.getPath('userData'), 'reports', runId)
  const report = { runId, title: scenario.title, baseUrl: scenario.url, status, logs: log, createdAt: new Date().toISOString() }
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  await writeFile(path.join(directory, 'report.html'), `<!doctype html><meta charset="utf-8"><title>${escapeHtml(scenario.title)} 결과</title><h1>${escapeHtml(scenario.title)}</h1><p>상태: ${escapeHtml(status)}</p><ul>${log.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`, 'utf8')
  return directory
}
const scenarioStorePath = (): string => path.join(app.getPath('userData'), 'scenarios.md')
const markerPositionStorePath = (): string => path.join(app.getPath('userData'), 'marker-positions.json')
const loadScenarioMarkdown = async (): Promise<string | null> => {
  try { return await readFile(scenarioStorePath(), 'utf8') } catch { return null }
}
const saveScenarioMarkdown = async (markdown: string): Promise<void> => {
  await writeFile(scenarioStorePath(), markdown, 'utf8')
}
const scenarioFileFilter = [{ name: 'Markdown 시나리오', extensions: ['md', 'markdown'] }]
const importScenarioFile = async (): Promise<{ markdown: string; filePath: string } | null> => {
  const result = await dialog.showOpenDialog({
    title: '시나리오 불러오기',
    properties: ['openFile'],
    filters: scenarioFileFilter
  })
  if (result.canceled) return null
  const filePath = result.filePaths[0]
  activeScenarioFilePath = filePath
  return { markdown: await readFile(filePath, 'utf8'), filePath }
}
const saveImportedScenarioFile = async (markdown: string): Promise<string | null> => {
  if (!activeScenarioFilePath) return null
  await writeFile(activeScenarioFilePath, markdown, 'utf8')
  return activeScenarioFilePath
}
const exportScenarioFile = async (markdown: string): Promise<string | null> => {
  const result = await dialog.showSaveDialog({
    title: '시나리오 저장하기',
    defaultPath: 'scenario.md',
    filters: scenarioFileFilter
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, markdown, 'utf8')
  activeScenarioFilePath = result.filePath
  return result.filePath
}
const loadMarkerPositions = async (): Promise<string | null> => {
  try { return await readFile(markerPositionStorePath(), 'utf8') } catch { return null }
}
const saveMarkerPositions = async (positions: string): Promise<void> => {
  await writeFile(markerPositionStorePath(), positions, 'utf8')
}
const failureVideoFileName = (scenario: QaScenario): string => {
  const now = new Date()
  const timestamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, '0'))
    .join('')
  const title = scenario.title.replace(/[\\/:*?"<>|]/g, '_').trim() || '시나리오'
  return `${title}_실패${timestamp}.webm`
}
const failureVideoDirectory = (): string => path.join(app.getPath('userData'), 'videos', 'failures')

const readableStep = (step: QaStep): string => `단계 ${step.id}: ${step.target} ${step.action === 'manualFill' ? '수동 입력' : step.action === 'manualResult' ? '수동 결과 확인' : step.action === 'fileUpload' ? '파일 업로드' : step.action}`
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const inputFor = (page: Page, target: string) => {
  const normalized = target.replace(/\s*(필드|입력란)$/, '').trim()
  const matcher = new RegExp(escapeRegex(normalized), 'i')
  return page.getByLabel(matcher).or(page.getByPlaceholder(matcher)).or(page.locator(`input[name*="${normalized}"], textarea[name*="${normalized}"]`)).first()
}
const actionTargetFor = (target: string): string => target.replace(/\s+(버튼을?|버튼)?\s*클릭$/, '').trim()
const clickTargetFor = async (page: Page, target: string, occurrence = 1, timeout = 0): Promise<Locator> => {
  const name = actionTargetFor(target)
    .replace(/\s*(아이콘|icon)$/, '')
    .replace(/\s*버튼$/, '')
    .trim()
  const selector = name.match(/^css=(.+)$/i)?.[1]?.trim()
  if (selector) return page.locator(selector).nth(Math.max(0, occurrence - 1))

  // 체크박스와 라디오는 숨겨진 input 대신 label을 클릭해야 UI 이벤트가 정상적으로 전달된다.
  // 마커가 줄바꿈을 공백으로 정리하므로, 라벨 비교도 공백을 무시해 일관되게 처리한다.
  const matcher = new RegExp(escapeRegex(name), 'i')
  const normalizedName = name.replace(/[\s\u200b]+/g, '')
  const deadline = Date.now() + timeout
  while (true) {
    for (const frame of page.frames()) {
      const labels = await frame.locator('label').all()
      const matchingLabels: Locator[] = []
      for (const label of labels) {
        const text = await label.textContent()
        if (text?.replace(/[\s\u200b]+/g, '').includes(normalizedName)) matchingLabels.push(label)
      }
      if (matchingLabels.length) return matchingLabels[Math.min(occurrence - 1, matchingLabels.length - 1)]

      // 일부 UI 컴포넌트는 label 역할을 노출하지 않는다. 자식 텍스트 클릭도 부모의 클릭 이벤트로 전달된다.
      const textTargets = frame.getByText(matcher)
      if (await textTargets.count()) return textTargets.nth(Math.max(0, occurrence - 1))
    }

    const buttons = page.getByRole('button', { name: matcher })
    if (await buttons.count()) {
      if (occurrence > 1) return buttons.nth(occurrence - 1)
      for (let index = (await buttons.count()) - 1; index >= 0; index -= 1) {
        const button = buttons.nth(index)
        if (!(await button.isVisible())) continue
        const isTopmost = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return topElement === element || element.contains(topElement)
        })
        if (isTopmost) return button
      }
      return buttons.first()
    }
    if (Date.now() >= deadline) return buttons.first()
    await page.waitForTimeout(100)
  }
}
const routeFor = (target: string): string => /^(https?:\/\/|\/)/.test(target.trim()) ? target.trim() : '/'
const resultTargetFor = (text: string): string => {
  let target = text.trim()
  let previous = ''
  while (target !== previous) {
    previous = target
    target = target
      .replace(/\s*결과\s*확인(?:을)?(?:한다)?\s*$/, '')
      .replace(/\s+(?:버튼(?:을)?\s*)?클릭\s*$/, '')
      .trim()
  }
  return target
}
const waitForVisibleText = async (page: Page, target: string, timeout = 10_000): Promise<void> => {
  const matcher = new RegExp(escapeRegex(target), 'i')
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const candidates = await page.getByText(matcher).all()
    for (const candidate of candidates) {
      try {
        if (await candidate.isVisible()) return
      } catch { /* 화면 전환 중 분리된 요소는 다음 반복에서 다시 찾는다. */ }
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`결과 텍스트 '${target}'가 ${Math.ceil(timeout / 1000)}초 안에 화면에 표시되지 않았습니다.`)
}
const hasVisibleText = async (page: Page, target: string): Promise<boolean> => {
  const candidates = await page.getByText(new RegExp(escapeRegex(target), 'i')).all()
  for (const candidate of candidates) {
    try {
      if (await candidate.isVisible()) return true
    } catch { /* 화면 전환 중 분리된 요소는 조건 불충족으로 처리한다. */ }
  }
  return false
}

const inspectScenario = async (scenario: QaScenario): Promise<Array<{ id: string; connected: boolean }>> => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    return await Promise.all(scenario.steps.map(async (step) => {
      if (step.action === 'goto' || step.action === 'manualResult') return { id: step.id, connected: true }
      const target = new RegExp(escapeRegex(step.target), 'i')
      const resultTarget = resultTargetFor(step.target)
      const locator = step.action === 'fill' || step.action === 'manualFill' || step.action === 'fileUpload'
        ? page.getByLabel(target).or(inputFor(page, step.target))
        : step.action === 'click' && resultTarget !== step.target
          ? page.getByText(resultTarget).first()
        : step.action === 'click'
          ? await clickTargetFor(page, step.target, step.occurrence)
          : page.getByRole('heading', { name: target }).or(page.getByText(target).first())
      return { id: step.id, connected: await locator.count() > 0 }
    }))
  } finally {
    await browser.close()
  }
}

const executeScenario = async (scenario: QaScenario, owner: BrowserWindow, options: QaRunOptions = {}): Promise<{ status: string; log: string[]; reportPath?: string }> => {
  const log: string[] = []
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Page | undefined
  let video: Video | null = null
  let previewInterval: ReturnType<typeof setInterval> | undefined
  let failed = false
  const run = { cancelled: false } as NonNullable<typeof activeRun>
  activeRun = run
  try {
    owner.webContents.send('qa:progress', { current: 0, total: scenario.steps.length, step: '브라우저 시작 중' })
    if (scenarioWorker && scenarioWorker.id !== options.workerId) await closeScenarioWorker()
    if (!scenarioWorker) {
      const workerBrowser = await chromium.launch({ headless: true, timeout: 15_000 })
      const videoDirectory = path.join(app.getPath('userData'), 'videos', 'temporary')
      await mkdir(videoDirectory, { recursive: true })
      const workerContext = await workerBrowser.newContext({ recordVideo: { dir: videoDirectory, size: { width: 1280, height: 720 } } })
      scenarioWorker = { id: options.workerId ?? `${Date.now()}`, browser: workerBrowser, context: workerContext }
    }
    browser = scenarioWorker.browser
    context = scenarioWorker.context
    run.browser = browser
    if (run.cancelled) return { status: 'cancelled', log: ['실행이 취소되었습니다.'], reportPath: await writeRunReport(scenario, 'cancelled', ['실행이 취소되었습니다.']) }
    page = await context.newPage()
    video = page.video()
    page.setDefaultTimeout(10_000)
    page.setDefaultNavigationTimeout(15_000)
    owner.webContents.send('qa:progress', { current: 0, total: scenario.steps.length, step: '기본 URL 접속 중' })
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded' })
    if (options.preview) {
      let capturing = false
      const sendPreview = async (): Promise<void> => {
        if (capturing || !page || owner.webContents.isDestroyed()) return
        capturing = true
        try {
          const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 })
          owner.webContents.send('qa:preview', `data:image/jpeg;base64,${screenshot.toString('base64')}`)
        } catch { /* 화면 전환 또는 종료 중인 캡처는 무시한다. */ }
        finally { capturing = false }
      }
      await sendPreview()
      previewInterval = setInterval(() => { void sendPreview() }, 200)
    }
    for (const [index, step] of scenario.steps.entries()) {
      if (run.cancelled) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
      if (step.condition && !(await hasVisibleText(page, step.condition))) {
        log.push(`${readableStep(step)} — 조건 '${step.condition}' 미충족으로 건너뜀`)
        owner.webContents.send('qa:progress', { current: index + 1, total: scenario.steps.length, step: readableStep(step) })
        continue
      }
      if (step.action === 'goto') await page.goto(new URL(routeFor(step.target), scenario.url).toString(), { waitUntil: 'domcontentloaded' })
      if (step.action === 'fill') await inputFor(page, step.target).fill(step.value ?? '')
      if (step.action === 'fileUpload') {
        if (!step.value?.trim()) throw new Error(`파일 업로드 단계 '${step.target}'에 업로드할 파일 경로가 없습니다.`)
        await inputFor(page, step.target).setInputFiles(step.value)
      }
      if (step.action === 'manualFill') {
        owner.webContents.send('qa:manual-required', { id: step.id, target: step.target, prompt: step.prompt, required: step.required })
        const value = await new Promise<string | null>((resolve) => { run.resolveManual = resolve })
        run.resolveManual = undefined
        if (run.cancelled || value === null) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
        await inputFor(page, step.target).fill(value)
        log.push(`${readableStep(step)} — 완료`)
      }
      if (step.action === 'manualResult') {
        owner.webContents.send('qa:manual-result-required', { id: step.id, target: step.target, prompt: step.prompt, timeoutSeconds: 300 })
        const result = await new Promise<ManualResult>((resolve) => {
          const timeout = setTimeout(() => {
            run.resolveManualResult = undefined
            resolve({ status: 'failed', reason: '수동 결과 확인 시간(5분)을 초과했습니다.' })
          }, 300_000)
          run.resolveManualResult = (value) => {
            clearTimeout(timeout)
            resolve(value)
          }
        })
        run.resolveManualResult = undefined
        if (run.cancelled) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
        if (result.status === 'failed') {
          const reason = result.reason?.trim() || '진행자가 실패로 판정했습니다.'
          const finalLog = [...log, `${readableStep(step)} — 실패: ${reason}`]
          failed = true
          return { status: 'failed', log: finalLog, reportPath: await writeRunReport(scenario, 'failed', finalLog) }
        }
        log.push(`${readableStep(step)} — 진행자가 성공으로 판정`)
      }
      if (step.action === 'click') {
        const resultTarget = resultTargetFor(step.target)
        if (resultTarget !== step.target) await waitForVisibleText(page, resultTarget)
        else {
          const timeout = (step.waitSeconds ?? 10) * 1000
          await (await clickTargetFor(page, step.target, step.occurrence, timeout)).click({ timeout })
        }
      }
      if (step.action === 'select') await page.getByLabel(step.target).selectOption(step.value ?? '')
      if (step.action === 'expectText') await waitForVisibleText(page, resultTargetFor(step.target), (step.waitSeconds ?? 10) * 1000)
      if (step.action !== 'manualFill' && step.action !== 'manualResult') log.push(`${readableStep(step)} — 완료`)
      owner.webContents.send('qa:progress', { current: index + 1, total: scenario.steps.length, step: readableStep(step) })
    }
    return { status: 'passed', log, reportPath: await writeRunReport(scenario, 'passed', log) }
  } catch (error) {
    failed = true
    const finalLog = [...log, `실행 실패: ${error instanceof Error ? error.message : String(error)}`]
    return { status: 'failed', log: finalLog, reportPath: await writeRunReport(scenario, 'failed', finalLog) }
  } finally {
    activeRun = null
    if (previewInterval) clearInterval(previewInterval)
    try { await page?.close() } catch { /* 취소로 페이지가 먼저 닫힌 경우는 무시한다. */ }
    if (failed && video) {
      try {
        const sourcePath = await video.path()
        const destination = path.join(failureVideoDirectory(), failureVideoFileName(scenario))
        await mkdir(failureVideoDirectory(), { recursive: true })
        await rename(sourcePath, destination)
        owner.webContents.send('qa:failure-video', destination)
      } catch { owner.webContents.send('qa:failure-video', null) }
    }
  }
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('scenario:load', () => loadScenarioMarkdown())
  ipcMain.handle('scenario:save', (_event, markdown: string) => saveScenarioMarkdown(markdown))
  ipcMain.handle('scenario:import-file', () => importScenarioFile())
  ipcMain.handle('scenario:save-imported-file', (_event, markdown: string) => saveImportedScenarioFile(markdown))
  ipcMain.handle('scenario:export-file', (_event, markdown: string) => exportScenarioFile(markdown))
  ipcMain.handle('marker-positions:load', () => loadMarkerPositions())
  ipcMain.handle('marker-positions:save', (_event, positions: string) => saveMarkerPositions(positions))
  ipcMain.handle('qa:start', async (event, scenario: QaScenario, options: QaRunOptions) => executeScenario(scenario, BrowserWindow.fromWebContents(event.sender)!, options))
  ipcMain.handle('qa:select-upload-file', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({ title: '업로드할 파일 선택', properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('qa:finish-worker', (_event, workerId: string) => closeScenarioWorker(workerId))
  ipcMain.handle('qa:inspect', (_event, scenario: QaScenario) => inspectScenario(scenario))
  ipcMain.handle('qa:download-failure-video', async (_event, filePath: string) => {
    if (path.dirname(filePath) !== failureVideoDirectory()) throw new Error('허용되지 않은 영상 경로입니다.')
    await readFile(filePath)
    const destination = path.join(app.getPath('downloads'), path.basename(filePath))
    await copyFile(filePath, destination)
    return destination
  })
  ipcMain.handle('qa:manual-input', (_event, value: string) => activeRun?.resolveManual?.(value))
  ipcMain.handle('qa:manual-result', (_event, result: ManualResult) => activeRun?.resolveManualResult?.(result))
  ipcMain.handle('qa:cancel', async () => {
    if (!activeRun) {
      await closeScenarioWorker()
      return
    }
    activeRun.cancelled = true
    activeRun.resolveManual?.(null)
    activeRun.resolveManualResult?.({ status: 'failed', reason: '실행이 취소되었습니다.' })
    await closeScenarioWorker()
  })
  createWindow()

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
