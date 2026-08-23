import 'dotenv/config'

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type Page } from '@playwright/test'

type QaStep = { id: string; action: 'goto' | 'fill' | 'manualFill' | 'click' | 'select' | 'expectText'; target: string; value?: string; required?: boolean; prompt?: string; occurrence?: number }
type QaScenario = { title: string; url: string; steps: QaStep[] }
type QaRunOptions = { preview?: boolean }
let activeRun: { browser?: Browser; resolveManual?: (value: string | null) => void; cancelled: boolean } | null = null

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
const importScenarioFile = async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    title: '시나리오 불러오기',
    properties: ['openFile'],
    filters: scenarioFileFilter
  })
  if (result.canceled) return null
  return readFile(result.filePaths[0], 'utf8')
}
const exportScenarioFile = async (markdown: string): Promise<string | null> => {
  const result = await dialog.showSaveDialog({
    title: '시나리오 저장하기',
    defaultPath: 'scenario.md',
    filters: scenarioFileFilter
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, markdown, 'utf8')
  return result.filePath
}
const loadMarkerPositions = async (): Promise<string | null> => {
  try { return await readFile(markerPositionStorePath(), 'utf8') } catch { return null }
}
const saveMarkerPositions = async (positions: string): Promise<void> => {
  await writeFile(markerPositionStorePath(), positions, 'utf8')
}

const readableStep = (step: QaStep): string => `단계 ${step.id}: ${step.target} ${step.action === 'manualFill' ? '수동 입력' : step.action}`
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const inputFor = (page: Page, target: string) => {
  const normalized = target.replace(/\s*(필드|입력란)$/, '').trim()
  const matcher = new RegExp(escapeRegex(normalized), 'i')
  return page.getByLabel(matcher).or(page.getByPlaceholder(matcher)).or(page.locator(`input[name*="${normalized}"], textarea[name*="${normalized}"]`)).first()
}
const actionTargetFor = (target: string): string => target.replace(/\s+(버튼을?|버튼)?\s*클릭$/, '').trim()
const buttonFor = (page: Page, target: string, occurrence = 1) => page.getByRole('button', { name: new RegExp(escapeRegex(actionTargetFor(target).replace(/\s*버튼$/, '').trim()), 'i') }).nth(Math.max(0, occurrence - 1))
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
const waitForVisibleText = async (page: Page, target: string): Promise<void> => {
  const matcher = new RegExp(escapeRegex(target), 'i')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const candidates = await page.getByText(matcher).all()
    for (const candidate of candidates) {
      try {
        if (await candidate.isVisible()) return
      } catch { /* 화면 전환 중 분리된 요소는 다음 반복에서 다시 찾는다. */ }
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`결과 텍스트 '${target}'가 10초 안에 화면에 표시되지 않았습니다.`)
}

const inspectScenario = async (scenario: QaScenario): Promise<Array<{ id: string; connected: boolean }>> => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    return await Promise.all(scenario.steps.map(async (step) => {
      if (step.action === 'goto') return { id: step.id, connected: true }
      const target = new RegExp(escapeRegex(step.target), 'i')
      const resultTarget = resultTargetFor(step.target)
      const locator = step.action === 'fill' || step.action === 'manualFill'
        ? page.getByLabel(target).or(inputFor(page, step.target))
        : step.action === 'click' && resultTarget !== step.target
          ? page.getByText(resultTarget).first()
        : step.action === 'click'
          ? buttonFor(page, step.target, step.occurrence)
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
  const run = { cancelled: false } as NonNullable<typeof activeRun>
  activeRun = run
  try {
    owner.webContents.send('qa:progress', { current: 0, total: scenario.steps.length, step: '브라우저 시작 중' })
    browser = await chromium.launch({ headless: true, timeout: 15_000 })
    run.browser = browser
    if (run.cancelled) return { status: 'cancelled', log: ['실행이 취소되었습니다.'], reportPath: await writeRunReport(scenario, 'cancelled', ['실행이 취소되었습니다.']) }
    const page = await browser.newPage()
    page.setDefaultTimeout(10_000)
    page.setDefaultNavigationTimeout(15_000)
    owner.webContents.send('qa:progress', { current: 0, total: scenario.steps.length, step: '기본 URL 접속 중' })
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded' })
    if (options.preview) {
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 })
      owner.webContents.send('qa:preview', `data:image/jpeg;base64,${screenshot.toString('base64')}`)
    }
    for (const [index, step] of scenario.steps.entries()) {
      if (run.cancelled) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
      if (step.action === 'goto') await page.goto(new URL(routeFor(step.target), scenario.url).toString(), { waitUntil: 'domcontentloaded' })
      if (step.action === 'fill') await inputFor(page, step.target).fill(step.value ?? '')
      if (step.action === 'manualFill') {
        owner.webContents.send('qa:manual-required', { id: step.id, target: step.target, prompt: step.prompt, required: step.required })
        const value = await new Promise<string | null>((resolve) => { run.resolveManual = resolve })
        run.resolveManual = undefined
        if (run.cancelled || value === null) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
        await inputFor(page, step.target).fill(value)
        log.push(`${readableStep(step)} — 완료`)
      }
      if (step.action === 'click') {
        const resultTarget = resultTargetFor(step.target)
        if (resultTarget !== step.target) await waitForVisibleText(page, resultTarget)
        else await buttonFor(page, step.target, step.occurrence).click()
      }
      if (step.action === 'select') await page.getByLabel(step.target).selectOption(step.value ?? '')
      if (step.action === 'expectText') await waitForVisibleText(page, resultTargetFor(step.target))
      if (step.action !== 'manualFill') log.push(`${readableStep(step)} — 완료`)
      owner.webContents.send('qa:progress', { current: index + 1, total: scenario.steps.length, step: readableStep(step) })
      if (options.preview) {
        try {
          const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 })
          owner.webContents.send('qa:preview', `data:image/jpeg;base64,${screenshot.toString('base64')}`)
        } catch { /* 화면 미리보기 실패는 시나리오 결과에 영향을 주지 않는다. */ }
      }
    }
    return { status: 'passed', log, reportPath: await writeRunReport(scenario, 'passed', log) }
  } catch (error) {
    const finalLog = [...log, `실행 실패: ${error instanceof Error ? error.message : String(error)}`]
    return { status: 'failed', log: finalLog, reportPath: await writeRunReport(scenario, 'failed', finalLog) }
  } finally {
    activeRun = null
    await browser?.close()
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
  ipcMain.handle('scenario:export-file', (_event, markdown: string) => exportScenarioFile(markdown))
  ipcMain.handle('marker-positions:load', () => loadMarkerPositions())
  ipcMain.handle('marker-positions:save', (_event, positions: string) => saveMarkerPositions(positions))
  ipcMain.handle('qa:start', async (event, scenario: QaScenario, options: QaRunOptions) => executeScenario(scenario, BrowserWindow.fromWebContents(event.sender)!, options))
  ipcMain.handle('qa:inspect', (_event, scenario: QaScenario) => inspectScenario(scenario))
  ipcMain.handle('qa:manual-input', (_event, value: string) => activeRun?.resolveManual?.(value))
  ipcMain.handle('qa:cancel', async () => {
    if (!activeRun) return
    activeRun.cancelled = true
    activeRun.resolveManual?.(null)
    await activeRun.browser?.close()
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
