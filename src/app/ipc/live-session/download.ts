import { app, BrowserWindow, dialog, type WebContents } from "electron";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { getCurrentSession, onSessionChanged } from "../auth/client";
import { readRecording } from "./service";
import { renderRecordingVideo } from "./video-export";
import type { RecordingScope } from "./types";

let exporting = false;
export const downloadRecordingVideo = async (owner: WebContents, id: string, documentId: string, scope: RecordingScope = "local"): Promise<string | null> => {
  if (exporting) throw new Error("다른 영상을 저장 중입니다. 완료 후 다시 시도해 주세요.");
  if (typeof id !== "string" || typeof documentId !== "string") throw new Error("올바르지 않은 기록입니다.");
  exporting = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("영상 저장 시간이 초과되었습니다.")), 180_000);
  const abort = () => controller.abort(new Error("계정이나 창이 변경되어 영상 저장을 중단했습니다."));
  const off = onSessionChanged(abort);
  owner.once("destroyed", abort);
  let directory: string | undefined;
  try {
    const auth = getCurrentSession();
    const recording = await readRecording(id, scope);
    controller.signal.throwIfAborted();
    const document = recording.documents.find(item => item.id === documentId);
    if (!document || !document.events.some(event => event.type === 2)) throw new Error("재생할 화면 기록이 없습니다.");
    if (recording.session.status === "recording") throw new Error("기록 수집이 끝난 후 다운로드해 주세요.");
    const title = (recording.session.title || "브라우저 기록").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 80);
    const options = { title: "브라우저 기록 MP4 저장", defaultPath: path.join(app.getPath("downloads"), `${title}_${Date.now()}.mp4`), filters: [{ name: "MP4 동영상", extensions: ["mp4"] }] };
    const parent = BrowserWindow.fromWebContents(owner);
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    controller.signal.throwIfAborted();
    directory = await mkdtemp(path.join(app.getPath("temp"), "checkly-replay-"));
    const video = await renderRecordingVideo(document, recording.session, directory, controller.signal);
    controller.signal.throwIfAborted();
    const current = getCurrentSession();
    if (auth?.userId !== current?.userId || auth?.projectId !== current?.projectId) throw new Error("계정이 변경되었습니다. 다시 시도해 주세요.");
    await copyFile(video, result.filePath);
    return result.filePath;
  } finally {
    clearTimeout(timeout); off(); owner.removeListener("destroyed", abort);
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { exporting = false; }
  }
};
