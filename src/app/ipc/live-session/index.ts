import { app, ipcMain } from "electron";
import type { MainDomain } from "../domain";
import { initializeTeamRecording, hasActiveRecordings, readRecording, receiveGuestBatch, receiveGuestError, removeRecording, snapshot, stopOwnerRecordings, uploadRecordings } from "./service";
import type { RecordingScope } from "./types";
import { downloadRecordingVideo } from "./download";

export const liveSessionDomain: MainDomain = {
  register: () => {
    initializeTeamRecording();
    ipcMain.handle("live-session:list", (_event, scope?: RecordingScope) => snapshot(scope));
    ipcMain.handle("live-session:read", (_event, id: string, scope?: RecordingScope) => readRecording(id, scope));
    ipcMain.handle("live-session:download-video", (event, id: string, documentId: string, scope?: RecordingScope) => downloadRecordingVideo(event.sender, id, documentId, scope));
    ipcMain.handle("live-session:remove", (_event, id: string, scope?: RecordingScope) => removeRecording(id, scope));
    ipcMain.handle("live-session:upload", async (event, ids: string[]) => {
      try { return await uploadRecordings(ids); }
      finally { if (!event.sender.isDestroyed()) event.sender.send("live-session:changed"); }
    });
    ipcMain.on("live-session:events", (event, key: string, batch: unknown) => receiveGuestBatch(event.sender, key, batch));
    ipcMain.on("live-session:failure", (event, payload: unknown) => receiveGuestError(event.sender, payload));
    let quitting = false;
    app.on("before-quit", event => {
      if (quitting || !hasActiveRecordings()) return;
      event.preventDefault();
      quitting = true;
      void stopOwnerRecordings().catch(error => console.error("라이브세션 종료 저장 실패", error)).finally(() => app.quit());
    });
  },
  attachWindow: window => {
    window.on("close", () => {
      void stopOwnerRecordings(window.webContents).catch(error => console.error("라이브세션 종료 저장 실패", error));
    });
  },
};
