// playwright-core가 사용자 캐시 대신 앱과 함께 번들된 로컬 브라우저를 찾도록,
// 다른 모듈이 로드되기 전에 설정해야 한다 (require 시점에 한 번만 반영됨).
process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

import "dotenv/config";

import { app, BrowserWindow, dialog, shell } from "electron";
import { is } from "@electron-toolkit/utils";
import path from "node:path";
import type { MainDomain } from "./ipc/domain";
import { apiTestingDomain } from "./api-testing";
import { formAutomationDomain } from "./ipc/form-automation";
import { qaDomain } from "./ipc/qa";
import { scenarioFileDomain } from "./ipc/scenario-file";
import { updateDomain } from "./ipc/update";
import { loadInitialWindowOptions, windowSettingsDomain } from "./ipc/window-settings";

// 개발 실행에서도 메뉴·About·종료 항목에 "Electron" 대신 앱 이름이 보이게 한다.
// 이름을 바꾸면 userData 경로도 따라 바뀌므로, 기존 데이터 위치는 그대로 유지한다.
const userDataPath = app.getPath("userData");
app.setName("Checkly");
app.setPath("userData", userDataPath);

// 새 기능은 해당 도메인의 index.ts에 추가한다. 이 목록은 도메인을 새로 만들 때만 수정한다.
const domains: MainDomain[] = [
  apiTestingDomain,
  formAutomationDomain,
  qaDomain,
  scenarioFileDomain,
  updateDomain,
  windowSettingsDomain,
];

const createWindow = async (): Promise<void> => {
  const mainWindow = new BrowserWindow({
    ...(await loadInitialWindowOptions()),
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

  // Electron silently cancels a close/quit/reload a page's beforeunload blocks (e.g. an unsaved
  // scenario), so ask here like a browser would. preventDefault() lets the unload go ahead.
  mainWindow.webContents.on("will-prevent-unload", event => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["계속 수정", "변경사항 버리고 나가기"],
      defaultId: 0,
      cancelId: 0,
      message: "저장하지 않은 변경사항이 있습니다",
      detail: "나가면 수정 내용이 사라집니다.",
    });
    if (choice === 1) event.preventDefault();
  });

  for (const domain of domains) await domain.attachWindow?.(mainWindow);

  if (is.dev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
};

app.whenReady().then(async () => {
  for (const domain of domains) domain.register?.();
  if (process.platform === "darwin" && is.dev) {
    app.dock?.setIcon(path.join(process.cwd(), "build/icons/icon.png"));
  }

  await createWindow();

  for (const domain of domains) domain.start?.();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const domain of domains) domain.beforeQuit?.();
});
