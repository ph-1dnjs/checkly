import { app, ipcMain } from "electron";
import type { MainDomain } from "../domain";
import { flushTeamLogs, flushTeamTelemetry, initializeTeamRecording, hasActiveRecordings, readRecording, receiveGuestBatch, receiveGuestError, removeRecording, snapshot, stopOwnerRecordings } from "./service";
import { getCurrentSession } from "../auth/client";

let syncTimer: ReturnType<typeof setInterval> | undefined;

export const liveSessionDomain: MainDomain = {
  register: () => {
    initializeTeamRecording();
    ipcMain.handle("live-session:list", () => snapshot());
    ipcMain.handle("live-session:read", (_event, id: string) => readRecording(id));
    ipcMain.handle("live-session:remove", async (_event, id: string) => { await removeRecording(id); });
    ipcMain.on("live-session:events", (event, key: string, batch: unknown) => receiveGuestBatch(event.sender, key, batch));
    ipcMain.on("live-session:failure", (event, payload: unknown) => receiveGuestError(event.sender, payload));
    let quitting = false;
    app.on("before-quit", event => {
      if (quitting || (!hasActiveRecordings() && !getCurrentSession())) return;
      event.preventDefault();
      quitting = true;
      void stopOwnerRecordings().then(() => flushTeamLogs()).catch(error => console.error("라이브세션 종료 저장 실패", error)).finally(() => app.quit());
    });
  },
  start: () => {
    syncTimer = setInterval(() => void flushTeamTelemetry().catch(error => console.error("팀 브라우저 로그 동기화 실패", error)), 5000);
    syncTimer.unref();
  },
  beforeQuit: () => { if (syncTimer) clearInterval(syncTimer); },
  attachWindow: window => {
    window.on("close", () => {
      void stopOwnerRecordings(window.webContents).catch(error => console.error("라이브세션 종료 저장 실패", error));
    });
  },
};
