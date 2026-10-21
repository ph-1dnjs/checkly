import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ApiTestingBridge } from "../../src/app/api-testing/shared/workspace";

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-mcp-desktop-"));
  const env = { ...process.env, CHECKLY_MCP_CONNECTION_FILE: path.join(directory, "discovery", "connection.json"), CHECKLY_SUPABASE_URL: "", CHECKLY_SUPABASE_ANON_KEY: "", CHECKLY_MCP_CONFIRM_TIMEOUT_MS: "2000" };
  delete env.ELECTRON_RUN_AS_NODE;
  // Serves both the OpenAPI document and the API the MCP run calls.
  const api = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(req.url === "/openapi.json" ? JSON.stringify({ openapi: "3.0.3", info: { title: "MCP", version: "1" }, paths: { "/ping": { get: { summary: "핑", responses: { "200": { description: "성공" } } } } } }) : '{"ok":true}');
  });
  await new Promise<void>(resolve => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const launch = () => electron.launch({ args: [".", `--user-data-dir=${directory}`], env });
  let app = await launch();
  const client = new Client({ name: "desktop-test", version: "1" });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
    const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID(), stageId = randomUUID();
    await page.evaluate(async ({ projectId, serverId, environmentId, stageId, apiUrl }) => {
      const bridge = (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting;
      await bridge.saveProject({ id: projectId, name: "MCP 데스크톱", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: apiUrl } }, { id: stageId, name: "stage", baseUrls: { [serverId]: "http://127.0.0.1:1" } }] });
      // AI 작성 도우미 needs a spec in the environment shown.
      for (const scope of [{ projectId, environmentId }, { projectId, environmentId: stageId }])
        await bridge.importSpec({ ...scope, serverId }, { kind: "url", url: `${apiUrl}/openapi.json` });
      await bridge.startMcp({ projectId, environmentId: stageId });
    }, { projectId, serverId, environmentId, stageId, apiUrl });
    const mcpStatus = () => page.evaluate(() => (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting.getMcpStatus());
    const pickEnvironment = async (name: string) => {
      await page.getByRole("button", { name: "API 환경", exact: true }).click();
      await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
    };
    await page.getByRole("button", { name: "API 테스트", exact: true }).click();
    // One project: no project picker or project settings any more.
    await expect(page.getByLabel("API 프로젝트", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "프로젝트 설정", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "AI 작성 도우미", exact: true }).click();
    await page.getByRole("tab", { name: "MCP로 연결", exact: true }).click();
    // How old the spec is, and a refresh, sit next to the way tabs.
    await expect(page.locator(".api-ai-spec-freshness")).toContainText("명세 갱신 · 오늘");
    await page.getByRole("button", { name: "명세 새로고침", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "명세를 새로 가져왔습니다." })).toBeVisible();
    // The connection follows the environment picked on the page; the header shows it.
    await pickEnvironment("dev");
    await expect.poll(mcpStatus).toMatchObject({ enabled: true, projectId, environmentId });
    await expect(page.locator(".api-mcp-chip")).toHaveText("MCP · dev");
    await expect(page.locator(".api-mcp-live")).toHaveText("연결됨 · dev");
    await expect(page.getByRole("switch", { name: "MCP 연결", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("MCP 실행 환경", { exact: true })).toHaveCount(0);
    // Registration is folded once connected; it is still there to copy.
    await page.getByText("처음 한 번: AI 앱에 등록", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "Claude Code", exact: true })).toBeChecked();
    await expect(page.getByLabel("Claude Code MCP 설정", { exact: true })).toHaveText(/^claude mcp add --scope user checkly -- node /);
    await page.getByRole("button", { name: "Claude Code 설치 명령 복사", exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(await page.getByLabel("Claude Code MCP 설정", { exact: true }).textContent());
    await page.getByRole("radio", { name: "Codex", exact: true }).check();
    await expect(page.getByLabel("Codex MCP 설정", { exact: true })).toHaveText(/codex mcp add checkly -- node/);
    await page.getByRole("button", { name: "Codex 설치 명령 복사", exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(await page.getByLabel("Codex MCP 설정", { exact: true }).textContent());
    // The guide-copy way is its own tab; MCP's controls are not on it.
    await page.getByRole("tab", { name: "가이드 복사", exact: true }).click();
    await expect(page.getByRole("button", { name: "AI 가이드 복사", exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "MCP 연결", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "MCP로 연결", exact: true }).click();
    const setup = await page.evaluate(() => (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting.getMcpSetup());
    await client.connect(new StdioClientTransport({ command: process.execPath, args: setup.args, stderr: "pipe" }));
    const result = await client.callTool({ name: "get_context", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result)).toContain(environmentId);
    await page.getByRole("switch", { name: "MCP 연결", exact: true }).click();
    await expect(page.locator(".api-mcp-chip")).toHaveCount(0);
    await expect(page.locator(".api-mcp-live")).toHaveCount(0);
    await expect(client.callTool({ name: "get_context", arguments: {} })).rejects.toThrow(/Checkly 앱/);
    await page.getByRole("switch", { name: "MCP 연결", exact: true }).click();
    await expect(page.getByRole("switch", { name: "MCP 연결", exact: true })).toHaveAttribute("aria-checked", "true");
    const reconnected = await client.callTool({ name: "get_context", arguments: {} });
    expect(reconnected.isError).toBeUndefined();
    expect(JSON.stringify(reconnected)).toContain(projectId);
    // Switching the page to stage moves the connection there, without touching the AI client.
    await pickEnvironment("stage");
    await expect.poll(mcpStatus).toMatchObject({ enabled: true, projectId, environmentId: stageId });
    await expect(page.locator(".api-mcp-chip")).toHaveText("MCP · stage");
    expect(JSON.stringify(await client.callTool({ name: "get_context", arguments: {} }))).toContain(stageId);
    await pickEnvironment("dev");
    await expect.poll(mcpStatus).toMatchObject({ environmentId });
    expect((await client.callTool({ name: "get_context", arguments: {} })).isError).toBeUndefined();

    // delete_scenario: the real native dialog opens on the app window and closes itself when nobody answers (2s here, 45s in the app).
    const saved = await page.evaluate(({ projectId, stageId }) => (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting
      .saveScenarioDraft({ projectId, environmentId: stageId }, "name: 지울 시나리오\nserver: API\nsteps:\n  - name: 조회\n    api: GET /x\n", {}), { projectId, stageId });
    const remaining = () => page.evaluate(id => (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting.listScenarios(id), projectId);
    await app.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { mcpDialogs: unknown[]; mcpAnswer?: number };
      state.mcpDialogs = [];
      const original = dialog.showMessageBox.bind(dialog);
      dialog.showMessageBox = (async (window: Electron.BrowserWindow, options: Electron.MessageBoxOptions) => {
        state.mcpDialogs.push({ parent: !!window, message: options.message, buttons: options.buttons, cancelId: options.cancelId, signal: !!options.signal });
        return state.mcpAnswer === undefined ? original(window, options) : { response: state.mcpAnswer, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    const deleteArgs = { name: "delete_scenario", arguments: { id: saved.id, expectedUpdatedAt: saved.updatedAt } };
    const started = Date.now();
    const unanswered = await client.callTool(deleteArgs, undefined, { timeout: 70_000 });
    const elapsed = Date.now() - started;
    // A person clicking the visible dialog during the run would change this; say so instead of a bare mismatch.
    expect(JSON.parse((unanswered.content as { text: string }[])[0].text).deleted, `확인 창이 ${elapsed}ms 만에 닫혔습니다. 실행 중 창을 누르지 마세요`).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(await remaining()).toHaveLength(1);
    const dialogs = await app.evaluate(() => (globalThis as unknown as { mcpDialogs: Array<Record<string, unknown>> }).mcpDialogs);
    expect(dialogs).toEqual([{ parent: true, message: "시나리오 '지울 시나리오'을(를) 삭제할까요?", buttons: ["삭제", "취소"], cancelId: 1, signal: true }]);
    // The user picks 취소, then 삭제.
    await app.evaluate(() => { (globalThis as unknown as { mcpAnswer: number }).mcpAnswer = 1; });
    expect(JSON.parse(((await client.callTool(deleteArgs)).content as { text: string }[])[0].text).deleted).toBe(false);
    expect(await remaining()).toHaveLength(1);
    await app.evaluate(() => { (globalThis as unknown as { mcpAnswer: number }).mcpAnswer = 0; });
    expect(JSON.parse(((await client.callTool(deleteArgs)).content as { text: string }[])[0].text).deleted).toBe(true);
    expect(await remaining()).toHaveLength(0);

    // An MCP run shows in the scenario screen with its full trace, marked as an external AI run.
    const ping = await page.evaluate(async ({ projectId, serverId, environmentId, apiUrl }) => {
      const bridge = (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting;
      await bridge.stopMcp();
      await bridge.importSpec({ projectId, serverId, environmentId }, { kind: "url", url: `${apiUrl}/openapi.json` });
      await bridge.startMcp({ projectId, environmentId });
      return bridge.saveScenario({ projectId, environmentId }, "name: MCP 핑\nserver: API\nsteps:\n  - name: 핑\n    api: GET /ping\n    auth: none\n", {});
    }, { projectId, serverId, environmentId, apiUrl });
    const mcpRun = JSON.parse(((await client.callTool({ name: "run_scenario", arguments: { id: ping.id, projectId, environmentId } })).content as { text: string }[])[0].text);
    await expect.poll(async () => JSON.parse(((await client.callTool({ name: "get_run", arguments: { runId: mcpRun.runId } })).content as { text: string }[])[0].text).state).toBe("passed");
    await page.getByRole("tab", { name: "시나리오", exact: true }).click();
    await page.getByRole("button", { name: "MCP 핑", exact: true }).first().click();
    await expect(page.getByText(/최근 실행 .* · 외부 AI\(MCP\)/)).toBeVisible();

    // A connection left on comes back after a restart without touching the settings.
    await app.close();
    app = await launch();
    const restarted = await app.firstWindow();
    await expect.poll(() => restarted.evaluate(() => (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting.getMcpStatus()), { timeout: 15_000 })
      .toMatchObject({ enabled: true, projectId, environmentId });
    const afterRestart = await client.callTool({ name: "get_context", arguments: {} });
    expect(afterRestart.isError).toBeUndefined();
    expect(JSON.stringify(afterRestart)).toContain(environmentId);
    // Turned off by the user, it stays off on the next start.
    await restarted.evaluate(() => (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting.stopMcp());
    await app.close();
    app = await launch();
    const offAgain = await app.firstWindow();
    await offAgain.waitForLoadState();
    await new Promise(resolve => setTimeout(resolve, 2_000));
    expect(await offAgain.evaluate(() => (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting.getMcpStatus())).toEqual({ enabled: false });
    console.log("MCP 데스크톱 E2E 통과: 설치 명령 복사 → stdio 연결/조회 → 끄기 → 설정 변경 없이 재연결 → 삭제 확인 창(무응답·취소·삭제) → MCP 실행 화면 표시 → 재시작 시 켜 둔 연결 복원·끈 연결 유지");
  } finally { await client.close(); await app.close(); api.closeAllConnections(); api.close(); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
