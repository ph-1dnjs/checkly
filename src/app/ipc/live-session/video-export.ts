import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { electronOutPath } from "../../paths";
import type { LiveSession, SessionDocument } from "./types";

const executeFile = promisify(execFile);
const fps = 15;

// Render recorded events locally at fixed timestamps; no live page or login is opened.
export const renderRecordingVideo = async (document: SessionDocument, session: LiveSession, directory: string, signal: AbortSignal): Promise<string> => {
  const first = document.events[0]?.timestamp;
  const last = document.events.at(-1)?.timestamp;
  const snapshot = document.events.find(event => event.type === 2)?.timestamp;
  if (first === undefined || last === undefined || snapshot === undefined) throw new Error("재생할 화면 기록이 없습니다.");
  const start = Math.max(first, session.captureStartAt ?? first);
  const end = Math.min(last, session.captureEndAt ?? last);
  if (![first, last, snapshot, start, end].every(Number.isFinite) || end < start || end - start > 60_000) {
    throw new Error("내보낼 수 없는 기록 구간입니다(최대 60초).");
  }
  if (!ffmpegPath) throw new Error("영상 변환 도구를 찾을 수 없습니다.");
  signal.throwIfAborted();
  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath().replace("app.asar", "app.asar.unpacked") });
  const abort = () => { void browser.close().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    page.setDefaultTimeout(15_000);
    await page.setContent('<!doctype html><html><head></head><body style="margin:0;background:#111;overflow:hidden"><div id="replay"></div></body></html>');
    await page.addStyleTag({ path: electronOutPath("live-session-replayer.css") });
    await page.addScriptTag({ path: electronOutPath("live-session-replayer.js") });
    await page.evaluate(({ events, initial }) => {
      const scope = window as unknown as {
        rrwebReplay: { Replayer: new (events: unknown[], config: object) => {
          pause: (offset: number) => void; on: (event: string, handler: (size: { width: number; height: number }) => void) => void;
          iframe: HTMLIFrameElement; wrapper: HTMLElement;
        } };
        exportPlayer: { pause: (offset: number) => void };
      };
      const player = new scope.rrwebReplay.Replayer(events, { root: window.document.getElementById("replay"), mouseTail: false, showWarning: false, showDebug: false, loadTimeout: 1000 });
      scope.exportPlayer = player;
      const fit = (size: { width: number; height: number }) => {
        const width = Math.max(1, size.width), height = Math.max(1, size.height);
        const scale = Math.min(1280 / width, 720 / height);
        Object.assign(player.wrapper.style, { width: `${width}px`, height: `${height}px`, transformOrigin: "top left", transform: `scale(${scale})`, marginLeft: `${(1280 - width * scale) / 2}px` });
        Object.assign(player.iframe.style, { width: `${width}px`, height: `${height}px`, maxWidth: "none" });
      };
      player.on("resize", fit);
      player.pause(initial);
      const meta = events.find(event => event.type === 4)?.data as { width: number; height: number } | undefined;
      fit(meta ?? { width: 1280, height: 720 });
    }, { events: document.events, initial: Math.max(snapshot - first + 1, start - first) });
    // Let external styles/images settle once; private assets have the same access limits as replay.
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
    const frames = Math.max(1, Math.ceil((end - start) / 1000 * fps));
    for (let frame = 0; frame < frames; frame++) {
      signal.throwIfAborted();
      const offset = Math.max(snapshot - first + 1, start - first + frame * 1000 / fps);
      await page.evaluate(time => (window as unknown as { exportPlayer: { pause: (time: number) => void } }).exportPlayer.pause(time), offset);
      await writeFile(path.join(directory, `frame-${String(frame).padStart(5, "0")}.png`), await page.screenshot({ type: "png" }));
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await browser.close();
  }
  signal.throwIfAborted();
  const output = path.join(directory, "recording.mp4");
  await executeFile(ffmpegPath.replace("app.asar", "app.asar.unpacked"), [
    "-y", "-framerate", String(fps), "-i", path.join(directory, "frame-%05d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", output,
  ], { timeout: 60_000, signal });
  return output;
};
