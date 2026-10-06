import { app, ipcMain } from "electron";
import type { MainDomain } from "../domain";
import {
  checkForUpdates,
  getLatestUpdateStatus,
  installUpdate,
  loadUpdateSettings,
  saveUpdateSettings,
  startPeriodicUpdateChecks,
} from "./update";

export const updateDomain: MainDomain = {
  register: () => {
    ipcMain.handle("app:version", () => app.getVersion());
    ipcMain.handle("update:check", () => checkForUpdates());
    ipcMain.handle("update:get-status", () => getLatestUpdateStatus());
    ipcMain.handle("update:install", () => installUpdate());
    ipcMain.handle("update:get-settings", () => loadUpdateSettings());
    ipcMain.handle("update:set-auto-check", (_event, autoCheck: boolean) =>
      saveUpdateSettings({ autoCheck }),
    );
  },
  start: () => startPeriodicUpdateChecks(),
};
