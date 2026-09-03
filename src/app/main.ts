// playwright-core가 사용자 캐시 대신 앱과 함께 번들된 로컬 브라우저를 찾도록,
// 다른 모듈이 로드되기 전에 설정해야 한다 (require 시점에 한 번만 반영됨).
process.env.PLAYWRIGHT_BROWSERS_PATH = '0'

import 'dotenv/config'

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Video } from '@playwright/test'

const executeFile = promisify(execFile)

type QaStep = { id: string; action: 'goto' | 'fill' | 'fileUpload' | 'manualFill' | 'manualControl' | 'manualResult' | 'click' | 'select' | 'expectText'; target: string; value?: string; required?: boolean; prompt?: string; condition?: string; waitSeconds?: number; occurrence?: number }
type QaScenario = { id: string; title: string; url: string; steps: QaStep[] }
type QaRunOptions = { preview?: boolean; workerId?: string }
type ManualResult = { status: 'passed' | 'failed'; reason?: string }
type ManualControlResult = { status: 'continue' | 'failed'; reason?: string }
type ManualBrowserEvent = { type: 'click' | 'wheel' | 'key' | 'text'; x?: number; y?: number; deltaY?: number; key?: string; text?: string }
let activeRun: { browser?: Browser; page?: Page; resolveManual?: (value: string | null) => void; resolveManualControl?: (value: ManualControlResult) => void; resolveManualResult?: (value: ManualResult) => void; cancelled: boolean } | null = null
let activeScenarioFilePath: string | null = null
let scenarioWorker: { id: string; browser: Browser; context: BrowserContext } | null = null

const closeScenarioWorker = async (workerId?: string): Promise<void> => {
  if (!scenarioWorker || (workerId && scenarioWorker.id !== workerId)) return
  const worker = scenarioWorker
  scenarioWorker = null
  try { await worker.context.close() } catch { /* 이미 종료된 컨텍스트는 무시한다. */ }
  try { await worker.browser.close() } catch { /* 이미 종료된 브라우저는 무시한다. */ }
}

const controlManualBrowser = async (event: ManualBrowserEvent): Promise<void> => {
  const page = activeRun?.page
  if (!page || activeRun?.cancelled) return
  if (event.type === 'click' && Number.isFinite(event.x) && Number.isFinite(event.y)) {
    await page.mouse.click(event.x!, event.y!)
    return
  }
  if (event.type === 'wheel' && Number.isFinite(event.deltaY)) {
    await page.mouse.wheel(0, event.deltaY!)
    return
  }
  if (event.type === 'text' && event.text) {
    await page.keyboard.insertText(event.text)
    return
  }
  if (event.type === 'key' && event.key) await page.keyboard.press(event.key)
}

const setQaViewport = async (size: { width: number; height: number }): Promise<void> => {
  const page = activeRun?.page
  if (!page || activeRun?.cancelled || page.isClosed()) return
  const width = Math.round(size.width)
  const height = Math.round(size.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 200) return
  try { await page.setViewportSize({ width, height }) } catch { /* 화면 전환 중인 페이지는 무시한다. */ }
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

type UpdateSettings = { autoCheck: boolean }
type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const updateSettingsStorePath = (): string => path.join(app.getPath('userData'), 'update-settings.json')
const loadUpdateSettings = async (): Promise<UpdateSettings> => {
  try {
    const raw = JSON.parse(await readFile(updateSettingsStorePath(), 'utf8')) as Partial<UpdateSettings>
    return { autoCheck: raw.autoCheck ?? true }
  } catch { return { autoCheck: true } }
}
const saveUpdateSettings = async (settings: UpdateSettings): Promise<void> => {
  await writeFile(updateSettingsStorePath(), JSON.stringify(settings), 'utf8')
}

let latestUpdateStatus: UpdateStatus = { state: 'idle' }
const broadcastUpdateStatus = (status: UpdateStatus): void => {
  latestUpdateStatus = status
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send('update:status', status)
  }
}

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.on('checking-for-update', () => broadcastUpdateStatus({ state: 'checking' }))
autoUpdater.on('update-available', (info) => broadcastUpdateStatus({ state: 'available', version: info.version }))
autoUpdater.on('update-not-available', () => broadcastUpdateStatus({ state: 'not-available' }))
autoUpdater.on('download-progress', (progress) => broadcastUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) }))
autoUpdater.on('update-downloaded', (info) => broadcastUpdateStatus({ state: 'downloaded', version: info.version }))
autoUpdater.on('error', (error) => broadcastUpdateStatus({ state: 'error', message: error.message }))

const checkForUpdates = async (): Promise<UpdateStatus> => {
  if (!app.isPackaged) return { state: 'not-available' }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    broadcastUpdateStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  return latestUpdateStatus
}
const runPeriodicUpdateCheck = async (): Promise<void> => {
  const settings = await loadUpdateSettings()
  if (settings.autoCheck) await checkForUpdates()
}
let updateCheckTimer: ReturnType<typeof setInterval> | undefined
type ScenarioFolderListing = { folderPath: string | null; files: Array<{ name: string; path: string; updatedAt: string }> }
const scenarioFolderStorePath = (): string => path.join(app.getPath('userData'), 'scenario-folder.json')
const readScenarioFolderPath = async (): Promise<string | null> => {
  try {
    const raw = JSON.parse(await readFile(scenarioFolderStorePath(), 'utf8')) as { folderPath?: string | null }
    return raw.folderPath ?? null
  } catch { return null }
}
const writeScenarioFolderPath = async (folderPath: string): Promise<void> => {
  await writeFile(scenarioFolderStorePath(), JSON.stringify({ folderPath }), 'utf8')
}
const listScenarioFolder = async (): Promise<ScenarioFolderListing> => {
  const folderPath = await readScenarioFolderPath()
  if (!folderPath) return { folderPath: null, files: [] }
  try {
    const entries = await readdir(folderPath)
    const mdEntries = entries.filter((name) => /\.(md|markdown)$/i.test(name))
    const files = await Promise.all(mdEntries.map(async (name) => {
      const filePath = path.join(folderPath, name)
      const info = await stat(filePath)
      return { name, path: filePath, updatedAt: info.mtime.toISOString() }
    }))
    files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { folderPath, files }
  } catch { return { folderPath: null, files: [] } }
}
const chooseScenarioFolder = async (): Promise<ScenarioFolderListing> => {
  const result = await dialog.showOpenDialog({ title: '시나리오 폴더 선택', properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths[0]) return listScenarioFolder()
  await writeScenarioFolderPath(result.filePaths[0])
  return listScenarioFolder()
}
const readScenarioFile = async (filePath: string): Promise<string | null> => {
  try { return await readFile(filePath, 'utf8') } catch { return null }
}
const runVideoFileName = (scenario: QaScenario): string => {
  const now = new Date()
  const timestamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, '0'))
    .join('')
  const title = scenario.title.replace(/[\\/:*?"<>|]/g, '_').trim() || '시나리오'
  return `${title}_실행${timestamp}.webm`
}
const runVideoDirectory = (): string => path.join(app.getPath('userData'), 'videos', 'runs')
const fullRunVideoFileName = (): string => `전체_시나리오_실행${Date.now()}.webm`
const ffmpegExecutablePath = ffmpegPath?.replace('app.asar', 'app.asar.unpacked')
// Playwright JS 코드는 asar 안에서도 실행되지만, 번들된 Chromium 실행 파일은 spawn 대상이라
// asar 밖(app.asar.unpacked)의 실제 경로를 가리켜야 한다. ffmpeg와 동일한 이유다.
const chromiumExecutablePath = chromium.executablePath().replace('app.asar', 'app.asar.unpacked')

const mergeRunVideos = async (filePaths: string[]): Promise<string | null> => {
  const videos = [...new Set(filePaths)]
  if (!videos.length) return null
  if (!ffmpegExecutablePath) throw new Error('영상 병합 도구를 찾을 수 없습니다.')
  if (videos.some((filePath) => path.dirname(filePath) !== runVideoDirectory())) {
    throw new Error('허용되지 않은 영상 경로입니다.')
  }
  const manifestPath = path.join(runVideoDirectory(), `concat-${Date.now()}.txt`)
  const destination = path.join(runVideoDirectory(), fullRunVideoFileName())
  await mkdir(runVideoDirectory(), { recursive: true })
  await writeFile(
    manifestPath,
    videos.map((filePath) => `file '${filePath.replace(/'/g, "'\\\\''")}'`).join('\n'),
    'utf8',
  )
  try {
    await executeFile(ffmpegExecutablePath, ['-y', '-f', 'concat', '-safe', '0', '-i', manifestPath, '-c', 'copy', destination])
    return destination
  } finally {
    await unlink(manifestPath).catch(() => undefined)
  }
}

const readableStep = (step: QaStep): string => `단계 ${step.id}: ${step.target} ${step.action === 'manualFill' ? '수동 입력' : step.action === 'manualControl' ? '브라우저 직접 제어' : step.action === 'manualResult' ? '수동 결과 확인' : step.action === 'fileUpload' ? '파일 업로드' : step.action}`
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const inputFor = (page: Page, target: string) => {
  const normalized = target.replace(/\s*(필드|입력란)$/, '').trim()
  const matcher = new RegExp(escapeRegex(normalized), 'i')
  return page.getByLabel(matcher).or(page.getByPlaceholder(matcher)).or(page.locator(`input[name*="${normalized}"], textarea[name*="${normalized}"]`)).first()
}
const selectFor = (page: Page, target: string) => {
  const selector = target.match(/^css=(.+)$/i)?.[1]?.trim()
  if (selector) return page.locator(selector).first()
  const matcher = new RegExp(escapeRegex(target), 'i')
  return page.getByLabel(matcher).or(page.locator(`select[name*="${target}"]`)).first()
}
const isNativeSelect = async (locator: Locator): Promise<boolean> => {
  if (!(await locator.count())) return false
  return locator.evaluate((element) => element instanceof HTMLSelectElement)
}
const actionTargetFor = (target: string): string => target.replace(/\s+(버튼을?|버튼)?\s*클릭$/, '').trim()
const clickTargetFor = async (page: Page, target: string, occurrence = 1, timeout = 0): Promise<Locator> => {
  const name = actionTargetFor(target)
    .replace(/\s*(아이콘|icon)$/, '')
    .replace(/\s*버튼$/, '')
    .trim()
  const selector = name.match(/^css=(.+)$/i)?.[1]?.trim()
  const cssTargets = selector ? page.locator(selector) : null
  // 체크박스와 라디오는 숨겨진 input 대신 label을 클릭해야 UI 이벤트가 정상적으로 전달된다.
  // 마커가 줄바꿈을 공백으로 정리하므로, 라벨 비교도 공백을 무시해 일관되게 처리한다.
  const matcher = selector ? null : new RegExp(escapeRegex(name), 'i')
  const normalizedName = selector ? '' : name.replace(/[\s\u200b]+/g, '')
  const deadline = Date.now() + timeout
  while (true) {
    if (cssTargets) {
      const visibleTargets: Locator[] = []
      for (let index = 0; index < await cssTargets.count(); index += 1) {
        const cssTarget = cssTargets.nth(index)
        if (await cssTarget.isVisible()) visibleTargets.push(cssTarget)
      }
      if (visibleTargets.length >= occurrence) return visibleTargets[occurrence - 1]
      if (Date.now() >= deadline) throw new Error(`CSS 클릭 대상 '${selector}'의 ${occurrence}번째 보이는 요소를 찾지 못했습니다.`)
      await page.waitForTimeout(100)
      continue
    }

    // 접근성 이름이 있는 버튼을 가장 먼저 찾는다. 일반 텍스트보다 버튼을 우선해야
    // 네비게이션·레이블의 중복 텍스트가 "n번째" 클릭 대상으로 섞이지 않는다.
    const visibleButtons: Locator[] = []
    for (const frame of page.frames()) {
      const buttons = frame.getByRole('button', { name: matcher! })
      for (let index = 0; index < await buttons.count(); index += 1) {
        const button = buttons.nth(index)
        if (await button.isVisible()) visibleButtons.push(button)
      }
    }
    if (visibleButtons.length >= occurrence) return visibleButtons[occurrence - 1]

    for (const frame of page.frames()) {
      const labels = await frame.locator('label').all()
      const matchingLabels: Locator[] = []
      for (const label of labels) {
        const text = await label.textContent()
        if (text?.replace(/[\s\u200b]+/g, '').includes(normalizedName) && await label.isVisible()) matchingLabels.push(label)
      }
      if (matchingLabels.length >= occurrence) return matchingLabels[occurrence - 1]

      // 일부 UI 컴포넌트는 label 역할을 노출하지 않는다. 자식 텍스트 클릭도 부모의 클릭 이벤트로 전달된다.
      const textTargets = frame.getByText(matcher!)
      const visibleTextTargets: Locator[] = []
      for (let index = 0; index < await textTargets.count(); index += 1) {
        const textTarget = textTargets.nth(index)
        if (await textTarget.isVisible()) visibleTextTargets.push(textTarget)
      }
      if (visibleTextTargets.length >= occurrence) return visibleTextTargets[occurrence - 1]
    }
    if (Date.now() >= deadline) throw new Error(`클릭 대상 '${name}'의 ${occurrence}번째 보이는 요소를 찾지 못했습니다.`)
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
const hasVisibleText = async (page: Page, target: string, timeout = 0): Promise<boolean> => {
  const matcher = new RegExp(escapeRegex(target), 'i')
  const deadline = Date.now() + timeout
  while (true) {
    const candidates = await page.getByText(matcher).all()
    for (const candidate of candidates) {
      try {
        if (await candidate.isVisible()) return true
      } catch { /* 화면 전환 중 분리된 요소는 다음 반복에서 다시 찾는다. */ }
    }
    if (Date.now() >= deadline) return false
    await page.waitForTimeout(100)
  }
}

const inspectScenario = async (scenario: QaScenario): Promise<Array<{ id: string; connected: boolean }>> => {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutablePath })
  try {
    const page = await browser.newPage()
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    return await Promise.all(scenario.steps.map(async (step) => {
      if (step.action === 'goto' || step.action === 'manualControl' || step.action === 'manualResult') return { id: step.id, connected: true }
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
  let activeStep: QaStep | undefined
  const run = { cancelled: false } as NonNullable<typeof activeRun>
  activeRun = run
  try {
    owner.webContents.send('qa:progress', { current: 0, total: scenario.steps.length, step: '브라우저 시작 중' })
    if (scenarioWorker && scenarioWorker.id !== options.workerId) await closeScenarioWorker()
    if (!scenarioWorker) {
      const workerBrowser = await chromium.launch({ headless: true, timeout: 15_000, executablePath: chromiumExecutablePath })
      const videoDirectory = path.join(app.getPath('userData'), 'videos', 'temporary')
      await mkdir(videoDirectory, { recursive: true })
      const workerContext = await workerBrowser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDirectory, size: { width: 1280, height: 720 } } })
      scenarioWorker = { id: options.workerId ?? `${Date.now()}`, browser: workerBrowser, context: workerContext }
    }
    browser = scenarioWorker.browser
    context = scenarioWorker.context
    run.browser = browser
    if (run.cancelled) return { status: 'cancelled', log: ['실행이 취소되었습니다.'], reportPath: await writeRunReport(scenario, 'cancelled', ['실행이 취소되었습니다.']) }
    page = await context.newPage()
    run.page = page
    context.on('page', (popup) => {
      run.page = popup
      popup.once('close', () => { if (!run.cancelled) run.page = page })
    })
    video = page.video()
    page.setDefaultTimeout(10_000)
    page.setDefaultNavigationTimeout(15_000)
    owner.webContents.send('qa:progress', { current: 0, total: scenario.steps.length, step: '기본 URL 접속 중' })
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded' })
    const captureStep = async (step: QaStep): Promise<void> => {
      const previewPage = run.page ?? page
      if (!previewPage || previewPage.isClosed() || owner.webContents.isDestroyed()) return
      try {
        const screenshot = await previewPage.screenshot({ type: 'jpeg', quality: 80 })
        owner.webContents.send('qa:step-preview', {
          scenarioId: scenario.id,
          stepId: step.id,
          image: `data:image/jpeg;base64,${screenshot.toString('base64')}`
        })
      } catch { /* 화면 전환 또는 종료 중인 캡처는 무시한다. */ }
    }
    if (options.preview || scenario.steps.some((step) => step.action === 'manualControl')) {
      let capturing = false
      const sendPreview = async (): Promise<void> => {
        const previewPage = run.page ?? page
        if (capturing || !previewPage || owner.webContents.isDestroyed()) return
        capturing = true
        try {
          const screenshot = await previewPage.screenshot({ type: 'jpeg', quality: 60 })
          owner.webContents.send('qa:preview', `data:image/jpeg;base64,${screenshot.toString('base64')}`)
        } catch { /* 화면 전환 또는 종료 중인 캡처는 무시한다. */ }
        finally { capturing = false }
      }
      await sendPreview()
      previewInterval = setInterval(() => { void sendPreview() }, 200)
    }
    for (const [index, step] of scenario.steps.entries()) {
      activeStep = step
      if (run.cancelled) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
      // 조건부 단계는 직전 클릭으로 표시되는 모달·토스트의 렌더링 시간을 짧게 허용한다.
      // 필요하면 시나리오의 [대기 N초]로 이 시간을 늘릴 수 있다.
      if (step.condition && !(await hasVisibleText(page, step.condition, (step.waitSeconds ?? 1) * 1000))) {
        log.push(`${readableStep(step)} — 조건 '${step.condition}' 미충족으로 건너뜀`)
        await captureStep(step)
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
        await captureStep(step)
        owner.webContents.send('qa:manual-required', { id: step.id, target: step.target, prompt: step.prompt, required: step.required })
        const value = await new Promise<string | null>((resolve) => { run.resolveManual = resolve })
        run.resolveManual = undefined
        if (run.cancelled || value === null) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
        await inputFor(page, step.target).fill(value)
        log.push(`${readableStep(step)} — 완료`)
      }
      if (step.action === 'manualControl') {
        await captureStep(step)
        owner.webContents.send('qa:manual-control-required', { id: step.id, target: step.target, prompt: step.prompt, timeoutSeconds: 300 })
        const result = await new Promise<ManualControlResult>((resolve) => {
          const timeout = setTimeout(() => {
            run.resolveManualControl = undefined
            resolve({ status: 'failed', reason: '브라우저 직접 제어 시간(5분)을 초과했습니다.' })
          }, 300_000)
          run.resolveManualControl = (value) => {
            clearTimeout(timeout)
            resolve(value)
          }
        })
        run.resolveManualControl = undefined
        if (run.cancelled) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
        if (result.status === 'failed') {
          const reason = result.reason?.trim() || '진행자가 실패로 판정했습니다.'
          const finalLog = [...log, `${readableStep(step)} — 실패: ${reason}`]
          return { status: 'failed', log: finalLog, reportPath: await writeRunReport(scenario, 'failed', finalLog) }
        }
        log.push(`${readableStep(step)} — 제어 완료`)
      }
      if (step.action === 'manualResult') {
        await captureStep(step)
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
      if (step.action === 'select') {
        const select = selectFor(page, step.target)
        if (await isNativeSelect(select)) {
          try { await select.selectOption({ label: step.value ?? '' }) }
          catch { await select.selectOption(step.value ?? '') }
        } else {
          const timeout = (step.waitSeconds ?? 10) * 1000
          await (await clickTargetFor(page, step.target, 1, timeout)).click({ timeout })
          await (await clickTargetFor(page, step.value ?? '', 1, timeout)).click({ timeout })
        }
      }
      if (step.action === 'expectText') await waitForVisibleText(page, resultTargetFor(step.target), (step.waitSeconds ?? 10) * 1000)
      if (step.action !== 'manualFill' && step.action !== 'manualControl' && step.action !== 'manualResult') log.push(`${readableStep(step)} — 완료`)
      await captureStep(step)
      owner.webContents.send('qa:progress', { current: index + 1, total: scenario.steps.length, step: readableStep(step) })
    }
    return { status: 'passed', log, reportPath: await writeRunReport(scenario, 'passed', log) }
  } catch (error) {
    if (activeStep && page && !page.isClosed() && !owner.webContents.isDestroyed()) {
      try {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 })
        owner.webContents.send('qa:step-preview', {
          scenarioId: scenario.id,
          stepId: activeStep.id,
          image: `data:image/jpeg;base64,${screenshot.toString('base64')}`
        })
      } catch { /* 실패 화면 캡처 자체가 실패한 경우는 무시한다. */ }
    }
    const finalLog = [...log, `실행 실패: ${error instanceof Error ? error.message : String(error)}`]
    return { status: 'failed', log: finalLog, reportPath: await writeRunReport(scenario, 'failed', finalLog) }
  } finally {
    activeRun = null
    if (previewInterval) clearInterval(previewInterval)
    try { await page?.close() } catch { /* 취소로 페이지가 먼저 닫힌 경우는 무시한다. */ }
    if (video) {
      try {
        const sourcePath = await video.path()
        const destination = path.join(runVideoDirectory(), runVideoFileName(scenario))
        await mkdir(runVideoDirectory(), { recursive: true })
        await rename(sourcePath, destination)
        owner.webContents.send('qa:run-video', destination)
      } catch { owner.webContents.send('qa:run-video', null) }
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
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:get-status', () => latestUpdateStatus)
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())
  ipcMain.handle('update:get-settings', () => loadUpdateSettings())
  ipcMain.handle('update:set-auto-check', (_event, autoCheck: boolean) => saveUpdateSettings({ autoCheck }))
  ipcMain.handle('scenario:load', () => loadScenarioMarkdown())
  ipcMain.handle('scenario:save', (_event, markdown: string) => saveScenarioMarkdown(markdown))
  ipcMain.handle('scenario:import-file', () => importScenarioFile())
  ipcMain.handle('scenario:save-imported-file', (_event, markdown: string) => saveImportedScenarioFile(markdown))
  ipcMain.handle('scenario:export-file', (_event, markdown: string) => exportScenarioFile(markdown))
  ipcMain.handle('marker-positions:load', () => loadMarkerPositions())
  ipcMain.handle('marker-positions:save', (_event, positions: string) => saveMarkerPositions(positions))
  ipcMain.handle('scenario:list-folder', () => listScenarioFolder())
  ipcMain.handle('scenario:choose-folder', () => chooseScenarioFolder())
  ipcMain.handle('scenario:read-file', (_event, filePath: string) => readScenarioFile(filePath))
  ipcMain.handle('qa:start', async (event, scenario: QaScenario, options: QaRunOptions) => executeScenario(scenario, BrowserWindow.fromWebContents(event.sender)!, options))
  ipcMain.handle('qa:select-upload-file', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({ title: '업로드할 파일 선택', properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('qa:finish-worker', (_event, workerId: string) => closeScenarioWorker(workerId))
  ipcMain.handle('qa:inspect', (_event, scenario: QaScenario) => inspectScenario(scenario))
  ipcMain.handle('qa:download-run-video', async (_event, filePath: string) => {
    if (path.dirname(filePath) !== runVideoDirectory()) throw new Error('허용되지 않은 영상 경로입니다.')
    await readFile(filePath)
    const destination = path.join(app.getPath('downloads'), path.basename(filePath))
    await copyFile(filePath, destination)
    return destination
  })
  ipcMain.handle('qa:merge-run-videos', async (_event, filePaths: string[]) => mergeRunVideos(filePaths))
  ipcMain.handle('qa:manual-input', (_event, value: string) => activeRun?.resolveManual?.(value))
  ipcMain.handle('qa:manual-control', (_event, result: ManualControlResult) => activeRun?.resolveManualControl?.(result))
  ipcMain.handle('qa:manual-browser-event', (_event, event: ManualBrowserEvent) => controlManualBrowser(event))
  ipcMain.handle('qa:set-viewport', (_event, size: { width: number; height: number }) => setQaViewport(size))
  ipcMain.handle('qa:manual-result', (_event, result: ManualResult) => activeRun?.resolveManualResult?.(result))
  ipcMain.handle('qa:cancel', async () => {
    if (!activeRun) {
      await closeScenarioWorker()
      return
    }
    activeRun.cancelled = true
    activeRun.resolveManual?.(null)
    activeRun.resolveManualControl?.({ status: 'failed', reason: '실행이 취소되었습니다.' })
    activeRun.resolveManualResult?.({ status: 'failed', reason: '실행이 취소되었습니다.' })
    await closeScenarioWorker()
  })
  createWindow()

  if (app.isPackaged) {
    void runPeriodicUpdateCheck()
    updateCheckTimer = setInterval(() => { void runPeriodicUpdateCheck() }, UPDATE_CHECK_INTERVAL_MS)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
