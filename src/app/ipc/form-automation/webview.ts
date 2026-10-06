import { session, type BrowserWindow, type WebContents } from "electron";
import { electronOutPath } from "../../paths";

const formAutomationSessions = new Set<ReturnType<typeof session.fromPartition>>();
const webviewPreloadPath = (): string =>
  electronOutPath("formAutomationWebviewPreload.js");

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
          preload: webviewPreloadPath(),
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

// 폼 자동 완성 webview(partition: persist:checkly-form-automation*)에만 전용 preload와 보안 설정을 적용한다.
export const attachFormAutomationWebviews = (mainWindow: BrowserWindow): void => {
  mainWindow.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    const partition = String(params.partition || webPreferences.partition || "");
    if (!partition.startsWith("persist:checkly-form-automation")) return;
    formAutomationSessions.add(session.fromPartition(partition));
    webPreferences.preload = webviewPreloadPath();
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
};
