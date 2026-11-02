import { session, BrowserWindow, webContents, type WebContents } from "electron";
import { electronOutPath } from "../../paths";
import { attachReplayGuest } from "../live-session/service";

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

const devToolsWindows = new Map<number, BrowserWindow>();

export const formAutomationDevToolsFor = (sender: WebContents): BrowserWindow[] =>
  [...devToolsWindows.entries()]
    .filter(([id, window]) => !window.isDestroyed() && !window.isMinimized() && window.isVisible()
      && webContents.fromId(id)?.hostWebContents === sender)
    .map(([, window]) => window);

export const openFormAutomationDevTools = (sender: WebContents, id: number): void => {
  const ownerWindow = BrowserWindow.fromWebContents(sender);
  const guest = Number.isInteger(id) ? webContents.fromId(id) : undefined;
  if (!ownerWindow || !guest || guest.isDestroyed() || guest.getType() !== "webview"
    || guest.hostWebContents !== sender || !formAutomationSessions.has(guest.session)) {
    throw new Error("개발자 도구를 열 브라우저 탭을 찾지 못했습니다.");
  }
  const existing = devToolsWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  // Electron's internal DevTools window does not dispatch before-input-event.
  // Host the same native DevTools in a BrowserWindow so shortcuts reach us.
  const devTools = new BrowserWindow({
    width: 1000,
    height: 750,
    show: false,
    title: "개발자 도구",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  devToolsWindows.set(id, devTools);
  devTools.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.meta || input.control) || !input.shift || input.alt
      || (input.code !== "KeyS" && input.key.toLowerCase() !== "s")) return;
    event.preventDefault();
    if (input.isAutoRepeat || ownerWindow.isDestroyed() || ownerWindow.webContents.isDestroyed()) return;
    ownerWindow.webContents.send("form-automation:devtools-capture-shortcut");
  });
  const close = () => { if (!devTools.isDestroyed()) devTools.close(); };
  guest.once("destroyed", close);
  guest.on("devtools-closed", close);
  devTools.on("closed", () => {
    devToolsWindows.delete(id);
    guest.removeListener("destroyed", close);
    guest.removeListener("devtools-closed", close);
    if (!guest.isDestroyed()) guest.closeDevTools();
  });
  guest.setDevToolsWebContents(devTools.webContents);
  guest.openDevTools({ mode: "detach" });
  devTools.show();
  devTools.focus();
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
    attachReplayGuest(childContents, ownerWindow.webContents, contents);
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
    attachReplayGuest(guestContents, mainWindow.webContents);
    configureFormAutomationPopups(guestContents, mainWindow);
  });
};
