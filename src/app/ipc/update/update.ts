import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type UpdateSettings = { autoCheck: boolean };
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const updateSettingsStorePath = (): string =>
  path.join(app.getPath("userData"), "update-settings.json");

export const loadUpdateSettings = async (): Promise<UpdateSettings> => {
  try {
    const raw = JSON.parse(
      await readFile(updateSettingsStorePath(), "utf8"),
    ) as Partial<UpdateSettings>;
    return { autoCheck: raw.autoCheck ?? true };
  } catch {
    return { autoCheck: true };
  }
};
export const saveUpdateSettings = async (
  settings: UpdateSettings,
): Promise<void> => {
  await writeFile(updateSettingsStorePath(), JSON.stringify(settings), "utf8");
};

let latestUpdateStatus: UpdateStatus = { state: "idle" };
export const getLatestUpdateStatus = (): UpdateStatus => latestUpdateStatus;
const broadcastUpdateStatus = (status: UpdateStatus): void => {
  latestUpdateStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed())
      window.webContents.send("update:status", status);
  }
};

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on("checking-for-update", () =>
  broadcastUpdateStatus({ state: "checking" }),
);
autoUpdater.on("update-available", (info) =>
  broadcastUpdateStatus({ state: "available", version: info.version }),
);
autoUpdater.on("update-not-available", () =>
  broadcastUpdateStatus({ state: "not-available" }),
);
autoUpdater.on("download-progress", (progress) =>
  broadcastUpdateStatus({
    state: "downloading",
    percent: Math.round(progress.percent),
  }),
);
autoUpdater.on("update-downloaded", (info) =>
  broadcastUpdateStatus({ state: "downloaded", version: info.version }),
);
autoUpdater.on("error", (error) =>
  broadcastUpdateStatus({ state: "error", message: error.message }),
);

export const checkForUpdates = async (): Promise<UpdateStatus> => {
  if (!app.isPackaged) return { state: "not-available" };
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    broadcastUpdateStatus({
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return latestUpdateStatus;
};
export const installUpdate = (): void => {
  autoUpdater.quitAndInstall();
};
const runPeriodicUpdateCheck = async (): Promise<void> => {
  const settings = await loadUpdateSettings();
  if (settings.autoCheck) await checkForUpdates();
};

let updateCheckTimer: ReturnType<typeof setInterval> | undefined;
export const startPeriodicUpdateChecks = (): void => {
  if (!app.isPackaged || updateCheckTimer) return;
  void runPeriodicUpdateCheck();
  updateCheckTimer = setInterval(() => {
    void runPeriodicUpdateCheck();
  }, UPDATE_CHECK_INTERVAL_MS);
};
