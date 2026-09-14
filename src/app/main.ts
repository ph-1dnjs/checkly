// playwright-core가 사용자 캐시 대신 앱과 함께 번들된 로컬 브라우저를 찾도록,
// 다른 모듈이 로드되기 전에 설정해야 한다 (require 시점에 한 번만 반영됨).
process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

import "dotenv/config";

import { app, BrowserWindow, ipcMain, session, shell, type WebContents } from "electron";
import { is } from "@electron-toolkit/utils";
import path from "node:path";
import {
  chooseScenarioFolder,
  exportScenarioFile,
  importScenarioFile,
  listScenarioFolder,
  loadMarkerPositions,
  loadScenarioMarkdown,
  readScenarioFile,
  saveImportedScenarioFile,
  saveMarkerPositions,
  saveScenarioMarkdown,
  selectUploadFile,
} from "./ipc/fileStorage";
import {
  cancelActiveRun,
  controlManualBrowser,
  executeScenario,
  finishQaWorker,
  inspectScenario,
  resolveManualControl,
  resolveManualInput,
  resolveManualResult,
  setQaViewport,
} from "./ipc/qaExecution";
import type {
  ManualBrowserEvent,
  ManualControlResult,
  ManualResult,
  QaRunOptions,
  QaScenario,
} from "./ipc/qaTypes";
import {
  checkForUpdates,
  getLatestUpdateStatus,
  installUpdate,
  loadUpdateSettings,
  saveUpdateSettings,
  startPeriodicUpdateChecks,
} from "./ipc/update";
import { downloadRunVideo, mergeRunVideos } from "./ipc/video";
import {
  appendFormAutomationSessionEvent,
  attachFormAutomationFixture,
  captureFormAutomationPage,
  clearFormAutomationSessionEvents,
  copyFormAutomationImage,
  copyFormAutomationText,
  exportFormAutomationSessionEvents,
  insertFormAutomationText,
  pickFormAutomationOpenApi,
  readFormAutomationSessionEvents,
  requestFormAutomationUrl,
  type FormAutomationFixtureInput,
  type FormAutomationTextInput,
} from "./ipc/formAutomation";

const formAutomationSessions = new Set<ReturnType<typeof session.fromPartition>>();

const safeWebUrl = (value: string, allowBlank = false): boolean => {
  if (allowBlank && (!value || value === "about:blank")) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const configureFormAutomationPopups = (
  contents: WebContents,
  ownerWindow: BrowserWindow,
): void => {
  contents.setWindowOpenHandler(({ url }) => {
    if (!safeWebUrl(url, true)) return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        parent: ownerWindow,
        autoHideMenuBar: true,
        backgroundColor: "#ffffff",
        webPreferences: {
          preload: path.join(__dirname, "formAutomationWebviewPreload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          allowRunningInsecureContent: false,
          session: contents.session,
        },
      },
    };
  });
  contents.on("did-create-window", (childWindow) => {
    childWindow.setMenuBarVisibility(false);
    const childContents = childWindow.webContents;
    const blockUnsafeNavigation = (event: Electron.Event, url: string) => {
      if (!safeWebUrl(url, true)) event.preventDefault();
    };
    childContents.on("will-navigate", blockUnsafeNavigation);
    childContents.on("will-redirect", blockUnsafeNavigation);
    configureFormAutomationPopups(childContents, ownerWindow);
  });
};

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    const partition = String(params.partition || webPreferences.partition || "");
    if (!partition.startsWith("persist:checkly-form-automation")) return;
    formAutomationSessions.add(session.fromPartition(partition));
    webPreferences.preload = path.join(__dirname, "formAutomationWebviewPreload.js");
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = false;
    webPreferences.allowRunningInsecureContent = false;
    if (!safeWebUrl(params.src)) params.src = "about:blank";
  });

  mainWindow.webContents.on("did-attach-webview", (_event, guestContents) => {
    if (!formAutomationSessions.has(guestContents.session)) return;
    configureFormAutomationPopups(guestContents, mainWindow);
  });

  if (is.dev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
};

app.whenReady().then(() => {
  if (process.platform === "darwin" && is.dev) {
    app.dock?.setIcon(path.join(process.cwd(), "build/icons/icon.png"));
  }

  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("update:check", () => checkForUpdates());
  ipcMain.handle("update:get-status", () => getLatestUpdateStatus());
  ipcMain.handle("update:install", () => installUpdate());
  ipcMain.handle("update:get-settings", () => loadUpdateSettings());
  ipcMain.handle("update:set-auto-check", (_event, autoCheck: boolean) =>
    saveUpdateSettings({ autoCheck }),
  );
  ipcMain.handle("scenario:load", () => loadScenarioMarkdown());
  ipcMain.handle("scenario:save", (_event, markdown: string) =>
    saveScenarioMarkdown(markdown),
  );
  ipcMain.handle("scenario:import-file", () => importScenarioFile());
  ipcMain.handle("scenario:save-imported-file", (_event, markdown: string) =>
    saveImportedScenarioFile(markdown),
  );
  ipcMain.handle("scenario:export-file", (_event, markdown: string) =>
    exportScenarioFile(markdown),
  );
  ipcMain.handle("marker-positions:load", () => loadMarkerPositions());
  ipcMain.handle("marker-positions:save", (_event, positions: string) =>
    saveMarkerPositions(positions),
  );
  ipcMain.handle("scenario:list-folder", () => listScenarioFolder());
  ipcMain.handle("scenario:choose-folder", () => chooseScenarioFolder());
  ipcMain.handle("scenario:read-file", (_event, filePath: string) =>
    readScenarioFile(filePath),
  );
  ipcMain.handle(
    "qa:start",
    async (event, scenario: QaScenario, options: QaRunOptions) =>
      executeScenario(
        scenario,
        BrowserWindow.fromWebContents(event.sender)!,
        options,
      ),
  );
  ipcMain.handle("qa:select-upload-file", () => selectUploadFile());
  ipcMain.handle("qa:finish-worker", (_event, workerId: string) =>
    finishQaWorker(workerId),
  );
  ipcMain.handle("qa:inspect", (_event, scenario: QaScenario) =>
    inspectScenario(scenario),
  );
  ipcMain.handle("qa:download-run-video", (_event, filePath: string) =>
    downloadRunVideo(filePath),
  );
  ipcMain.handle("qa:merge-run-videos", (_event, filePaths: string[]) =>
    mergeRunVideos(filePaths),
  );
  ipcMain.handle("qa:manual-input", (_event, value: string) =>
    resolveManualInput(value),
  );
  ipcMain.handle("qa:manual-control", (_event, result: ManualControlResult) =>
    resolveManualControl(result),
  );
  ipcMain.handle(
    "qa:manual-browser-event",
    (_event, event: ManualBrowserEvent) => controlManualBrowser(event),
  );
  ipcMain.handle(
    "qa:set-viewport",
    (_event, size: { width: number; height: number }) => setQaViewport(size),
  );
  ipcMain.handle("qa:manual-result", (_event, result: ManualResult) =>
    resolveManualResult(result),
  );
  ipcMain.handle("qa:cancel", () => cancelActiveRun());
  ipcMain.handle(
    "form-automation:insert-text",
    (_event, input: FormAutomationTextInput) => insertFormAutomationText(input),
  );
  ipcMain.handle(
    "form-automation:attach-fixture",
    (_event, input: FormAutomationFixtureInput) =>
      attachFormAutomationFixture(input),
  );
  ipcMain.handle("form-automation:capture-page", (event) =>
    captureFormAutomationPage(event.sender),
  );
  ipcMain.handle("form-automation:copy-image", (_event, dataUrl: string) =>
    copyFormAutomationImage(dataUrl),
  );
  ipcMain.handle("form-automation:copy-text", (_event, text: string) =>
    copyFormAutomationText(text),
  );
  ipcMain.handle("form-automation:save-session-event", (_event, payload: Record<string, unknown>) =>
    appendFormAutomationSessionEvent(payload),
  );
  ipcMain.handle("form-automation:read-session-events", (_event, limit?: number) =>
    readFormAutomationSessionEvents(limit),
  );
  ipcMain.handle("form-automation:clear-session-events", () =>
    clearFormAutomationSessionEvents(),
  );
  ipcMain.handle("form-automation:export-session-events", () =>
    exportFormAutomationSessionEvents(),
  );
  ipcMain.handle("form-automation:http-request", (_event, input) =>
    requestFormAutomationUrl(input),
  );
  ipcMain.handle("form-automation:pick-openapi", () => pickFormAutomationOpenApi());
  createWindow();

  startPeriodicUpdateChecks();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
