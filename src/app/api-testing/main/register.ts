import { app, clipboard, dialog, ipcMain, safeStorage } from "electron";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ApiWorkspace, scopeSchema } from "./workspace";
import { specSourceSchema } from "../shared/workspace";
import { z } from "zod";
import { SpecSync } from "./spec-sync";
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
  ipcMain.handle("api-testing:ai-context", (_event, request) => workspace.buildAiContext(request));
  ipcMain.handle("api-testing:copy-ai-context", async (_event, request) => {
    clipboard.writeText(await workspace.buildAiContext(request));
  });
  ipcMain.handle("api-testing:list-projects", () => workspace.listProjects());
  ipcMain.handle("api-testing:save-project", (_event, project) => workspace.saveProject(project));
  ipcMain.handle("api-testing:delete-project", (_event, id) => workspace.deleteProject(id));
  ipcMain.handle("api-testing:delete-catalog", (_event, scope) => workspace.deleteCatalog(scope));
  ipcMain.handle("api-testing:delete-scenario", (_event, projectId, id, revision) => workspace.deleteScenario(projectId, id, revision));
  ipcMain.handle("api-testing:catalog", (_event, scope) => workspace.getCatalog(scope));
  ipcMain.handle("api-testing:execute", (_event, scope, key, request) => workspace.execute(scope, z.string().parse(key), request));
  ipcMain.handle("api-testing:execute-live", (_event, scope, key, request) => workspace.executeLive(scope, z.string().parse(key), request));
  ipcMain.handle("api-testing:cancel", async (event, rawScope) => {
    const scope = scopeSchema.parse(rawScope);
    await workspace.cancel(scope);
    releasePendingInputs(event.sender, scope);
  });
  ipcMain.handle("api-testing:list-globals", (_event, scope) => workspace.listGlobals(scope));
  ipcMain.handle("api-testing:set-global", (_event, scope, name, value) => workspace.setGlobal(scope, name, value));
  ipcMain.handle("api-testing:delete-global", (_event, scope, name) => workspace.deleteGlobal(scope, name));
  ipcMain.handle("api-testing:list-scenarios", (_event, projectId) => workspace.listScenarios(projectId));
  ipcMain.handle("api-testing:preview-scenario", (_event, scope, source, bindings) => workspace.previewScenario(scope, source, bindings));
  ipcMain.handle("api-testing:save-scenario", (_event, scope, source, bindings, revision) => workspace.saveScenario(scope, source, bindings, revision));
  ipcMain.handle("api-testing:save-scenario-draft", (_event, scope, source, bindings, revision) => workspace.saveScenarioDraft(scope, source, bindings, revision));
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
