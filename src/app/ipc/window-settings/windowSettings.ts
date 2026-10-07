import { app, BrowserWindow, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ResolutionPreset = { label: string; width: number; height: number };

// PC 환경에서 흔히 쓰이는 해상도 (가로 × 세로) 기준으로 구성한다.
export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { label: "1200 × 800 (기본값)", width: 1200, height: 800 },
  { label: "1280 × 720 (HD)", width: 1280, height: 720 },
  { label: "1366 × 768 (HD+)", width: 1366, height: 768 },
  { label: "1600 × 900 (HD+)", width: 1600, height: 900 },
  { label: "1920 × 1080 (FHD)", width: 1920, height: 1080 },
  { label: "1920 × 1200 (WUXGA)", width: 1920, height: 1200 },
  { label: "2560 × 1440 (QHD)", width: 2560, height: 1440 },
  { label: "3840 × 2160 (4K UHD)", width: 3840, height: 2160 },
];

export type WindowSettings = {
  // OS 전체화면(fullscreen)이 아니라, 타이틀바/작업표시줄은 유지한 채 창을
  // 화면 크기에 맞춰 최대화(maximize)하는 옵션이다.
  fillScreenOnStartup: boolean;
  width: number;
  height: number;
};

const DEFAULT_WINDOW_SETTINGS: WindowSettings = {
  fillScreenOnStartup: false,
  width: 1200,
  height: 800,
};

const windowSettingsStorePath = (): string =>
  path.join(app.getPath("userData"), "window-settings.json");

export const loadWindowSettings = async (): Promise<WindowSettings> => {
  try {
    const raw = JSON.parse(
      await readFile(windowSettingsStorePath(), "utf8"),
    ) as Partial<WindowSettings>;
    return {
      fillScreenOnStartup:
        raw.fillScreenOnStartup ?? DEFAULT_WINDOW_SETTINGS.fillScreenOnStartup,
      width: raw.width ?? DEFAULT_WINDOW_SETTINGS.width,
      height: raw.height ?? DEFAULT_WINDOW_SETTINGS.height,
    };
  } catch {
    return DEFAULT_WINDOW_SETTINGS;
  }
};

export const saveWindowSettings = async (
  settings: WindowSettings,
): Promise<void> => {
  await writeFile(windowSettingsStorePath(), JSON.stringify(settings), "utf8");
};

// BrowserWindow 생성자에 바로 펼쳐 쓸 수 있는 형태로 돌려준다 (main.ts의 diff를 최소화하기 위함).
export const loadInitialWindowOptions = async (): Promise<{
  width: number;
  height: number;
}> => {
  const settings = await loadWindowSettings();
  return { width: settings.width, height: settings.height };
};

// 생성자 옵션만으로는 "최대화 상태로 시작"을 표현할 수 없어, 창을 만든 뒤 호출한다.
export const applyInitialWindowState = async (
  window: BrowserWindow,
): Promise<void> => {
  const settings = await loadWindowSettings();
  if (settings.fillScreenOnStartup) window.maximize();
};

// 이 기능과 관련된 ipcMain 핸들러를 한곳에 모아 등록한다.
// main.ts는 이 함수를 호출하는 한 줄만 알면 되므로, 다른 기능과 같은 파일/같은 자리를
// 동시에 건드릴 일이 없어 병합 충돌 표면이 줄어든다.
export const registerWindowSettingsIpc = (): void => {
  ipcMain.handle("window:get-settings", () => loadWindowSettings());
  ipcMain.handle("window:get-resolution-presets", () => RESOLUTION_PRESETS);
  ipcMain.handle(
    "window:set-fill-screen-on-startup",
    async (_event, fillScreenOnStartup: boolean) => {
      const settings = await loadWindowSettings();
      const next = { ...settings, fillScreenOnStartup };
      await saveWindowSettings(next);
      for (const window of BrowserWindow.getAllWindows()) {
        if (fillScreenOnStartup) window.maximize();
        else {
          window.unmaximize();
          window.setSize(next.width, next.height);
        }
      }
      return next;
    },
  );
  ipcMain.handle(
    "window:set-resolution",
    async (_event, size: { width: number; height: number }) => {
      const settings = await loadWindowSettings();
      const next = { ...settings, width: size.width, height: size.height };
      await saveWindowSettings(next);
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isMaximized()) window.setSize(size.width, size.height);
      }
      return next;
    },
  );
};
