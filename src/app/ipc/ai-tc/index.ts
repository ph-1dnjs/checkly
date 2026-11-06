import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { parsePreparation, preparationPrompt } from "./prepare";
import { FixtureMaker } from "./fixtures";
import type { AiTcCase } from "./model";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { chromium } from "@playwright/test";
import type { MainDomain } from "../domain";
import { availableTools, callModel, type ModelUsage } from "./ai";
import { AiTcImportError, readWorkbook } from "./excel";
import { exportRunWorkbook } from "./export";
import { AI_TC_LIMITS } from "./model";
import { AiTcRunner } from "./runner";

/** 사용자가 고른 업로드 파일. renderer·모델에는 토큰과 이름만 준다. */
const uploads = new Map<string, string>();
let temporaryDir: string | undefined;

const broadcast = (channel: string, value: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, value);
};

let runner: AiTcRunner | undefined;
const getRunner = () => runner ??= new AiTcRunner({
  emit: state => broadcast("ai-tc:state", state),
  preview: (runId, image) => broadcast("ai-tc:preview", { runId, image }),
  dataDir: path.join(app.getPath("userData"), "ai-tc"),
  ask: callModel,
  toolPath: async tool => (await availableTools()).find(item => item.tool === tool)?.path,
  resolveFile: token => uploads.get(token),
  executablePath: chromium.executablePath().replace("app.asar", "app.asar.unpacked"),
});

export const aiTcDomain: MainDomain = {
  register: () => {
    // 사용자가 고른 .xlsx만 읽는다. 원본은 바꾸지 않고, 경로는 renderer에 돌려주지 않는다.
    ipcMain.handle("ai-tc:import", async event => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { title: "TC 엑셀 가져오기", properties: ["openFile" as const], filters: [{ name: "Excel", extensions: ["xlsx"] }] };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const filePath = picked.filePaths[0];
      if (picked.canceled || !filePath) return null;
      try {
        if ((await stat(filePath)).size > AI_TC_LIMITS.fileBytes) throw new AiTcImportError(`파일이 ${Math.round(AI_TC_LIMITS.fileBytes / 1024 / 1024)}MB를 넘습니다.`);
        return { workbook: await readWorkbook(path.basename(filePath), await readFile(filePath)) };
      } catch (error) {
        return { error: error instanceof AiTcImportError ? error.message : `파일을 읽지 못했습니다: ${(error as Error).message}` };
      }
    });
    ipcMain.handle("ai-tc:pick-upload", async event => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { title: "업로드할 테스트 파일", properties: ["openFile" as const] };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const filePath = picked.filePaths[0];
      if (picked.canceled || !filePath) return null;
      const token = randomUUID();
      uploads.set(token, filePath);
      return { token, name: path.basename(filePath) };
    });
    // TC·시나리오 문맥으로 입력값과 업로드 파일을 정하고, 파일은 임시 폴더에 만들어 업로드 토큰으로 등록한다.
    ipcMain.handle("ai-tc:prepare", async (event, input: unknown) => {
      const { tool, cases } = z.object({ tool: z.enum(["claude", "codex"]), cases: z.array(z.object({
        key: z.string().max(2000), id: z.string().max(200), scenarioId: z.string().max(1000), pre: z.string().max(10000),
        steps: z.array(z.string().max(10000)).max(100), expected: z.array(z.object({ id: z.string(), text: z.string().max(10000) })).max(50),
        given: z.string().max(10000), scenario: z.string().max(4000),
      })).min(1).max(20) }).parse(input);
      const executable = (await availableTools()).find(item => item.tool === tool);
      if (!executable) throw new Error("선택한 AI CLI를 찾지 못했습니다.");
      temporaryDir ??= await mkdtemp(path.join(os.tmpdir(), "checkly-ai-tc-"));
      const today = new Date().toLocaleDateString("sv-SE");
      let usage: ModelUsage | undefined;
      let reply: string;
      try {
        reply = await callModel({ tool, file: executable.path, cwd: temporaryDir, prompt: preparationPrompt(cases, today), timeoutMs: 240_000, onUsage: value => { usage = value; } }).promise;
      } finally {
        if (!event.sender.isDestroyed()) event.sender.send("ai-tc:prepare-usage", { tool, usage });
      }
      const results = parsePreparation(reply, cases.map(item => item.key));
      const maker = new FixtureMaker(temporaryDir, chromium.executablePath().replace("app.asar", "app.asar.unpacked"));
      try {
        const out = [];
        for (const result of results) {
          const id = cases.find(item => item.key === result.key)!.id;
          const files = [];
          for (const spec of result.files) {
            const made = await maker.make(spec, `${id.replace(/[^\w-]/g, "")}_${randomUUID().slice(0, 4)}`);
            const token = randomUUID();
            uploads.set(token, made.filePath);
            files.push({ label: spec.label, token, name: made.name, spec: `${spec.type.toUpperCase()}${spec.width ? ` ${spec.width}×${spec.height ?? spec.width}` : ""} · ${Math.max(1, Math.round(made.bytes / 1024))}KB` });
          }
          out.push({ key: result.key, data: result.data, files, note: result.note ?? "" });
        }
        return out;
      } finally { await maker.close(); }
    });
    ipcMain.handle("ai-tc:tools", async () => (await availableTools()).map(item => ({ tool: item.tool, version: item.version })));
    ipcMain.handle("ai-tc:start", (_event, plan: unknown) => getRunner().start(plan));
    ipcMain.handle("ai-tc:replay", (_event, runId: unknown, assisted: unknown) => getRunner().startReplay(runId, z.boolean().default(false).parse(assisted)));
    ipcMain.handle("ai-tc:replay-saved", (_event, plan: unknown, assisted: unknown) => getRunner().startSavedReplay(plan, z.boolean().default(false).parse(assisted)));
    ipcMain.handle("ai-tc:saved-needs", (_event, plan: unknown) => getRunner().savedNeeds(plan));
    ipcMain.handle("ai-tc:decide", (_event, runId: unknown, decision: unknown, reply: unknown) => getRunner().decide(runId, decision, reply));
    ipcMain.handle("ai-tc:browser-event", (_event, runId: unknown, input: unknown) => getRunner().browserEvent(runId, input));
    ipcMain.handle("ai-tc:cancel", (_event, runId: unknown) => getRunner().cancel(runId));
    ipcMain.handle("ai-tc:review", (_event, input: unknown) => getRunner().review(input));
    ipcMain.handle("ai-tc:approve-assertion", (_event, input: unknown) => getRunner().approveAssertion(input));
    ipcMain.handle("ai-tc:apply-repair", (_event, input: unknown) => getRunner().applyRepair(input));
    ipcMain.handle("ai-tc:capture", (_event, runId: unknown, captureId: unknown) => getRunner().capture(runId, captureId));
    ipcMain.handle("ai-tc:current", () => getRunner().current());
    // 결과를 .xlsx로 저장한다. 캡처·영상은 산출물 폴더에 남아 있어 함께 열 수 있다.
    ipcMain.handle("ai-tc:export", async (event, runId: unknown) => {
      const target = getRunner().exportable(runId);
      if (!target) throw new Error("끝난 실행만 내보낼 수 있습니다.");
      const window = BrowserWindow.fromWebContents(event.sender);
      const defaultPath = path.join(app.getPath("downloads"), `AI-TC-결과-${target.state.startedAt.slice(0, 16).replace(/[:T]/g, "-")}.xlsx`);
      const options = { title: "AI TC 결과 저장", defaultPath, filters: [{ name: "Excel", extensions: ["xlsx"] }] };
      const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return null;
      await writeFile(picked.filePath, await exportRunWorkbook(target.state, target.environment));
      return path.basename(picked.filePath);
    });
    ipcMain.handle("ai-tc:download-video", async (event, runId: unknown) => {
      const file = await getRunner().videoPath(runId);
      if (!file) throw new Error("다운로드할 영상이 없습니다.");
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { title: "AI TC 영상 저장", defaultPath: path.join(app.getPath("downloads"), "AI-TC-영상.webm"), filters: [{ name: "WebM", extensions: ["webm"] }] };
      const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return null;
      await copyFile(file, picked.filePath);
      return path.basename(picked.filePath);
    });
    ipcMain.handle("ai-tc:open-folder", async (_event, runId: unknown) => {
      const target = getRunner().exportable(runId);
      if (target) await shell.openPath(target.dir);
    });
  },
  beforeQuit: async () => { await runner?.shutdown(); if (temporaryDir) await rm(temporaryDir, { recursive: true, force: true }); },
};
