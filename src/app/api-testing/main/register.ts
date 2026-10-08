import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ApiWorkspace, scopeSchema } from "./workspace";
import { specSourceSchema } from "../shared/workspace";
import { z } from "zod";
import { SpecSync } from "./spec-sync";
import { AiTerminalService } from "./ai-terminal";
import { describeAiTools } from "./ai-cli";
import { isProvidedScenarioInput, matchesScenarioInputType, type Json, type ScenarioInputRequest } from "../shared/scenario";
import type { ApiScenarioInputRequest } from "../shared/workspace";

export function registerApiTesting() {
  const workspace = new ApiWorkspace(path.join(app.getPath("userData"), "api-testing"));
  const sync = new SpecSync(path.join(app.getPath("userData"), "api-testing"), workspace, {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: value => safeStorage.encryptString(value).toString("base64"),
    decrypt: value => safeStorage.decryptString(Buffer.from(value, "base64")),
  });
  const inputScopeSchema = scopeSchema.omit({ serverId: true });
  const pendingInputs = new Map<string, {
    sender: Electron.WebContents;
    scope: z.infer<typeof inputScopeSchema>;
    request: ApiScenarioInputRequest;
    resolve: (value: Json | undefined) => void;
    timeout: NodeJS.Timeout;
    onDestroyed: () => void;
  }>();
  const sameInputScope = (left: z.infer<typeof inputScopeSchema>, right: z.infer<typeof inputScopeSchema>) => left.projectId === right.projectId && left.environmentId === right.environmentId;
  const releasePendingInputs = (sender: Electron.WebContents, scope: z.infer<typeof inputScopeSchema>) => {
    for (const [requestId, pending] of pendingInputs) {
      if (pending.sender !== sender || !sameInputScope(pending.scope, scope)) continue;
      clearTimeout(pending.timeout); sender.removeListener("destroyed", pending.onDestroyed);
      pendingInputs.delete(requestId); pending.resolve(undefined);
    }
  };
  const requestScenarioInput = (sender: Electron.WebContents, scope: z.infer<typeof inputScopeSchema>, request: ScenarioInputRequest): Promise<Json | undefined> => new Promise(resolve => {
    const requestId = randomUUID();
    const publicRequest: ApiScenarioInputRequest = { ...request, requestId };
    const finish = (value: Json | undefined) => {
      const pending = pendingInputs.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeout); sender.removeListener("destroyed", pending.onDestroyed);
      pendingInputs.delete(requestId); pending.resolve(value);
    };
    const onDestroyed = () => finish(undefined);
    const timeout = setTimeout(() => finish(undefined), 300_000);
    pendingInputs.set(requestId, { sender, scope, request: publicRequest, resolve, timeout, onDestroyed });
    sender.once("destroyed", onDestroyed);
    try { sender.send("api-testing:scenario-input-required", publicRequest); }
    catch { finish(undefined); }
  });
  ipcMain.handle("api-testing:spec-sync", (_event, scope) => sync.get(scope));
  ipcMain.handle("api-testing:delete-spec-account", (_event, scope) => sync.deleteAccount(scope));
  ipcMain.handle("api-testing:get-request-auth", (_event, scope) => workspace.getRequestAuth(scope));
  ipcMain.handle("api-testing:set-request-auth", (_event, scope, variable) => workspace.setRequestAuth(scope, variable));
  ipcMain.handle("api-testing:copy-ai-prompt", async (_event, request) => {
    clipboard.writeText(await workspace.buildAiPrompt(request));
  });
  // A quitting app does not take its child processes along on macOS.
  const terminals = new AiTerminalService(workspace, event => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("api-testing:ai-terminal-event", event);
  });
  app.on("before-quit", () => terminals.stopAll());
  ipcMain.handle("api-testing:get-ai-terminal", (_event, projectId) => terminals.get(projectId));
  ipcMain.handle("api-testing:start-ai-terminal", (_event, request) => terminals.start(request));
  ipcMain.handle("api-testing:resume-ai-terminal", (_event, request) => terminals.resume(request));
  ipcMain.on("api-testing:write-ai-terminal", (_event, projectId, data) => { try { terminals.write(projectId, data); } catch { /* Ignored: bad input from the screen. */ } });
  ipcMain.on("api-testing:resize-ai-terminal", (_event, projectId, size) => { try { terminals.resize(projectId, size); } catch { /* Ignored. */ } });
  ipcMain.handle("api-testing:clear-ai-terminal", (_event, projectId) => terminals.clear(projectId));
  ipcMain.handle("api-testing:check-ai-terminal-result", (_event, scope) => workspace.checkAiTerminalResult(scope));
  ipcMain.handle("api-testing:mark-ai-terminal-result-saved", (_event, projectId, saved) => terminals.markSaved(projectId, saved));
  ipcMain.handle("api-testing:refresh-ai-terminal-files", (_event, scope) => workspace.refreshAiChatFiles(scope));
  ipcMain.handle("api-testing:ai-chat-status", async (_event, refresh) => {
    const tools = (await describeAiTools(refresh === true)).map(({ tool, version }) => ({ tool, version }));
    return tools.length ? { tools } : { tools, error: "Claude Code나 Codex CLI를 찾지 못했습니다. 설치한 뒤 다시 확인하세요" };
  });
  ipcMain.handle("api-testing:get-ai-chat-settings", (_event, projectId) => workspace.getAiChatSettings(projectId));
  ipcMain.handle("api-testing:save-ai-chat-settings", (_event, projectId, settings) => workspace.saveAiChatSettings(projectId, settings));
  ipcMain.handle("api-testing:choose-directories", async () => {
    const selected = await dialog.showOpenDialog({ title: "백엔드 코드 폴더 선택", properties: ["openDirectory", "multiSelections"] });
    return selected.canceled ? [] : selected.filePaths;
  });
  ipcMain.handle("api-testing:get-ai-prompt", (_event, request) => workspace.buildAiPrompt(request));
  ipcMain.handle("api-testing:read-ai-result", (_event, scope) => workspace.readAiResult(scope));
  ipcMain.handle("api-testing:check-ai-scenarios", (_event, scope, text) => workspace.checkAiScenarios(scope, text));
  ipcMain.handle("api-testing:list-projects", () => workspace.listProjects());
  ipcMain.handle("api-testing:save-project", (_event, project) => workspace.saveProject(project));
  ipcMain.handle("api-testing:delete-project", async (_event, id) => { await terminals.forget(id); await workspace.deleteProject(id); });
  ipcMain.handle("api-testing:delete-catalog", (_event, scope) => workspace.deleteCatalog(scope));
  ipcMain.handle("api-testing:delete-scenario", (_event, projectId, id, revision) => workspace.deleteScenario(projectId, id, revision));
  ipcMain.handle("api-testing:catalog", (_event, scope) => workspace.getCatalog(scope));
  ipcMain.handle("api-testing:execute", (_event, scope, key, request) => workspace.execute(scope, z.string().parse(key), request));  ipcMain.handle("api-testing:cancel", async (event, rawScope) => {
    const scope = scopeSchema.parse(rawScope);
    await workspace.cancel(scope);
    releasePendingInputs(event.sender, scope);
  });
  ipcMain.handle("api-testing:list-globals", (_event, scope) => workspace.listGlobals(scope));
  ipcMain.handle("api-testing:set-global", (_event, scope, name, value) => workspace.setGlobal(scope, name, value));
  ipcMain.handle("api-testing:delete-global", (_event, scope, name) => workspace.deleteGlobal(scope, name));
  ipcMain.handle("api-testing:list-cookies", (_event, scope) => workspace.listCookies(scope));
  ipcMain.handle("api-testing:clear-cookies", (_event, scope) => workspace.clearCookies(scope));
  ipcMain.handle("api-testing:list-scenarios", (_event, projectId) => workspace.listScenarios(projectId));
  ipcMain.handle("api-testing:check-scenario-specs", (_event, scope) => workspace.checkScenarioSpecs(scope));
  ipcMain.handle("api-testing:apply-title-renames", (_event, scope) => workspace.applyTitleRenames(scope));
  ipcMain.handle("api-testing:keep-titles", (_event, scope, scenarioId) => workspace.keepTitles(scope, scenarioId));
  ipcMain.handle("api-testing:get-doc-inputs", (_event, scope) => workspace.getDocInputs(scope));
  ipcMain.handle("api-testing:forget-doc-input", (_event, scope, key) => workspace.forgetDocInput(scope, key));
  ipcMain.handle("api-testing:list-suites", (_event, projectId) => workspace.listSuites(projectId));
  ipcMain.handle("api-testing:save-suite", (_event, projectId, suite, revision) => workspace.saveSuite(projectId, suite, revision));
  ipcMain.handle("api-testing:delete-suite", (_event, projectId, id, revision) => workspace.deleteSuite(projectId, id, revision));
  ipcMain.handle("api-testing:save-suite-report", async (_event, rawFilename, rawHtml) => {
    const filename = z.string().regex(/^checkly-api-report-[A-Za-z0-9-]+\.html$/).parse(rawFilename);
    const html = z.string().max(2_000_000).startsWith("<!doctype html>").parse(rawHtml);
    const selected = await dialog.showSaveDialog({ defaultPath: filename, filters: [{ name: "HTML 리포트", extensions: ["html"] }] });
    if (selected.canceled || !selected.filePath) return null;
    await writeFile(selected.filePath, html, "utf8");
    return selected.filePath;
  });
  ipcMain.handle("api-testing:preview-scenario", (_event, scope, source, bindings) => workspace.previewScenario(scope, source, bindings));
  ipcMain.handle("api-testing:save-scenario", (_event, scope, source, bindings, revision, metadata) => workspace.saveScenario(scope, source, bindings, revision, metadata));
  ipcMain.handle("api-testing:save-scenario-draft", (_event, scope, source, bindings, revision, metadata) => workspace.saveScenarioDraft(scope, source, bindings, revision, metadata));
  ipcMain.handle("api-testing:run-scenario", (event, rawScope, source, bindings, inputs) => {
    const scope = inputScopeSchema.parse(rawScope);
    const runId = randomUUID();
    return workspace.runScenario(scope, source, bindings, inputs, {
      runId,
      requestInput: request => requestScenarioInput(event.sender, scope, request),
    });
  });
  ipcMain.handle("api-testing:get-pending-input", (event, rawScope) => {
    const scope = inputScopeSchema.parse(rawScope);
    return [...pendingInputs.values()].find(pending => pending.sender === event.sender && sameInputScope(pending.scope, scope))?.request ?? null;
  });
  ipcMain.handle("api-testing:submit-input", (event, rawScope, rawSubmission) => {
    const scope = inputScopeSchema.parse(rawScope);
    const submission = z.object({
      requestId: z.string().uuid(), runId: z.string().uuid(), stepId: z.string().min(1), name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), value: z.json(),
    }).strict().parse(rawSubmission);
    const pending = pendingInputs.get(submission.requestId);
    if (!pending || pending.sender !== event.sender || !sameInputScope(pending.scope, scope) || pending.request.runId !== submission.runId || pending.request.stepId !== submission.stepId || pending.request.name !== submission.name) throw new Error("실행 중인 입력 요청이 아닙니다");
    if (pending.request.required && !isProvidedScenarioInput(submission.value)) throw new Error("필수 입력값을 입력하세요");
    if (isProvidedScenarioInput(submission.value) && !matchesScenarioInputType(submission.value, pending.request.type)) throw new Error("입력 형식이 설정된 타입과 다릅니다");
    clearTimeout(pending.timeout); event.sender.removeListener("destroyed", pending.onDestroyed);
    pendingInputs.delete(submission.requestId); pending.resolve(submission.value);
  });
  ipcMain.handle("api-testing:export-project", async (_event, projectId) => {
    const text = await workspace.exportProject(projectId);
    const name = (JSON.parse(text) as { project: { name: string } }).project.name.replace(/[\\/:*?"<>|]/g, "_");
    const selected = await dialog.showSaveDialog({ defaultPath: `${name}.checkly-api.json`, filters: [{ name: "Checkly API 프로젝트", extensions: ["json"] }] });
    if (selected.canceled || !selected.filePath) return null;
    await writeFile(selected.filePath, text, "utf8");
    return selected.filePath;
  });
  ipcMain.handle("api-testing:read-project-file", async () => {
    const selected = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Checkly API 프로젝트", extensions: ["json"] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    if ((await stat(selected.filePaths[0])).size > 10_000_000) throw new Error("프로젝트 파일은 10MB 이하만 지원합니다");
    return readFile(selected.filePaths[0], "utf8");
  });
  ipcMain.handle("api-testing:plan-project-import", (_event, text) => workspace.planProjectImport(z.string().parse(text)));
  ipcMain.handle("api-testing:import-project", (_event, text, update) => workspace.importProject(z.string().parse(text), update));
  ipcMain.handle("api-testing:read-scenario-file", async () => {
    const selected = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "시나리오 YAML", extensions: ["yaml", "yml"] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    if ((await stat(selected.filePaths[0])).size > 1_000_000) throw new Error("시나리오는 1MB 이하만 지원합니다");
    return readFile(selected.filePaths[0], "utf8");
  });
  ipcMain.handle("api-testing:import", async (_event, rawScope, rawSource) => {
    const scope = scopeSchema.parse(rawScope);
    const parsed = specSourceSchema.safeParse(rawSource);
    if (!parsed.success) throw new Error("명세 주소와 인증 입력을 확인하세요. 아이디에 콜론은 사용할 수 없습니다");
    const source = parsed.data;
    let text: string;
    if (source.kind === "file") {
      const selected = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "OpenAPI", extensions: ["json", "yaml", "yml"] }] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      if ((await stat(selected.filePaths[0])).size > 5_000_000) throw new Error("명세는 5MB 이하만 지원합니다");
      text = await readFile(selected.filePaths[0], "utf8");
    } else {
      return sync.importUrl(scope, source);
    }
    return workspace.importSpec(scope, text);
  });
}
