import 'dotenv/config'

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type Page } from '@playwright/test'

type QaStep = { id: string; action: 'goto' | 'fill' | 'manualFill' | 'click' | 'select' | 'expectText'; target: string; value?: string; required?: boolean; prompt?: string }
type QaScenario = { title: string; url: string; steps: QaStep[] }
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
const loadScenarioMarkdown = async (): Promise<string | null> => {
  try { return await readFile(scenarioStorePath(), 'utf8') } catch { return null }
}
const saveScenarioMarkdown = async (markdown: string): Promise<void> => {
  await writeFile(scenarioStorePath(), markdown, 'utf8')
}

const readableStep = (step: QaStep): string => `단계 ${step.id}: ${step.target} ${step.action === 'manualFill' ? '수동 입력' : step.action}`
const inputFor = (page: Page, target: string) => page.locator(`input[placeholder*="${target}"], input[name*="${target}"], textarea[placeholder*="${target}"]`).first()
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const inspectScenario = async (scenario: QaScenario): Promise<Array<{ id: string; connected: boolean }>> => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    return await Promise.all(scenario.steps.map(async (step) => {
      if (step.action === 'goto') return { id: step.id, connected: true }
      const target = new RegExp(escapeRegex(step.target), 'i')
      const locator = step.action === 'fill' || step.action === 'manualFill'
        ? page.getByLabel(target).or(inputFor(page, step.target))
        : page.getByRole(step.action === 'expectText' ? 'heading' : 'button', { name: target }).or(page.getByText(target).first())
      return { id: step.id, connected: await locator.count() > 0 }
    }))
  } finally {
    await browser.close()
  }
}

const executeScenario = async (scenario: QaScenario, owner: BrowserWindow): Promise<{ status: string; log: string[]; reportPath?: string }> => {
  const log: string[] = []
  const browser = await chromium.launch({ headless: true })
  const run = { browser, cancelled: false } as NonNullable<typeof activeRun>
  activeRun = run
  const page = await browser.newPage()
  try {
    for (const step of scenario.steps) {
      if (run.cancelled) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
      if (step.action === 'goto') await page.goto(new URL(step.target, scenario.url).toString())
      if (step.action === 'fill') await inputFor(page, step.target).fill(step.value ?? '')
      if (step.action === 'manualFill') {
        owner.webContents.send('qa:manual-required', { id: step.id, target: step.target, prompt: step.prompt, required: step.required })
        const value = await new Promise<string | null>((resolve) => { run.resolveManual = resolve })
        run.resolveManual = undefined
        if (run.cancelled || value === null) { const finalLog = [...log, '실행이 취소되었습니다.']; return { status: 'cancelled', log: finalLog, reportPath: await writeRunReport(scenario, 'cancelled', finalLog) } }
        await inputFor(page, step.target).fill(value)
        log.push(`${readableStep(step)} — 완료`)
      }
      if (step.action === 'click') await page.getByRole('button', { name: step.target }).click()
      if (step.action === 'select') await page.getByLabel(step.target).selectOption(step.value ?? '')
      if (step.action === 'expectText') await page.getByText(step.target).first().waitFor({ state: 'visible' })
      if (step.action !== 'manualFill') log.push(`${readableStep(step)} — 완료`)
    }
    return { status: 'passed', log, reportPath: await writeRunReport(scenario, 'passed', log) }
  } catch (error) {
    const finalLog = [...log, `실행 실패: ${error instanceof Error ? error.message : String(error)}`]
    return { status: 'failed', log: finalLog, reportPath: await writeRunReport(scenario, 'failed', finalLog) }
  } finally {
    activeRun = null
    await browser.close()
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
  ipcMain.handle('qa:start', async (event, scenario: QaScenario) => executeScenario(scenario, BrowserWindow.fromWebContents(event.sender)!))
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
