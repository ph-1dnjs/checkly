import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { AiTerminalService, claudeSessionExists, claudeTerminalArgs, codexTerminalArgs, openingPrompt, type SpawnTerminal, type TerminalProcess } from "../../src/app/api-testing/main/ai-terminal";
import type { ApiAiTerminalEvent, ApiAiTool } from "../../src/app/api-testing/shared/workspace";

const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "상점", version: "1" }, paths: {
  "/login": { post: { summary: "로그인", responses: { "200": { description: "성공" } } } },
} });
const good = "name: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-terminal-"));
  const workspace = new ApiWorkspace(dir);
  const serverId = randomUUID(), environmentId = randomUUID();
  const project = { id: randomUUID(), name: "AI", servers: [{ id: serverId, name: "상점" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://shop.example.com" } }] };
  await workspace.saveProject(project);
  await workspace.importSpec({ projectId: project.id, serverId, environmentId }, spec);
  const backend = path.join(dir, "backend");
  await mkdir(backend);
  await workspace.saveAiChatSettings(project.id, { folders: { [serverId]: [backend] } });
  return { dir, workspace, project, backend, scope: { projectId: project.id, environmentId } };
}

/** A fake terminal process that records what it was started with and what was typed. */
function fakeSpawn() {
  const runs: Array<{ file: string; args: string[]; cwd: string; typed: string[]; process: TerminalProcess & { output(data: string): void; exit(code: number): void; killed: boolean } }> = [];
  const spawn: SpawnTerminal = (file, args, options) => {
    let onData: (data: string) => void = () => undefined, onExit: (event: { exitCode: number }) => void = () => undefined;
    const typed: string[] = [];
    const process = {
      killed: false,
      onData(listener: (data: string) => void) { onData = listener; },
      onExit(listener: (event: { exitCode: number }) => void) { onExit = listener; },
      write(data: string) { typed.push(data); },
      resize() { /* Not needed here. */ },
      kill() { process.killed = true; onExit({ exitCode: 0 }); },
      output(data: string) { onData(data); },
      exit(code: number) { onExit({ exitCode: code }); },
    };
    runs.push({ file, args, cwd: options.cwd, typed, process });
    return process;
  };
  return { runs, spawn };
}

const service = (workspace: ApiWorkspace, spawn: SpawnTerminal, events: ApiAiTerminalEvent[], tools: ApiAiTool[] = ["claude"]) =>
  new AiTerminalService(workspace, event => events.push(event), spawn, async () => tools.map(tool => ({ tool, path: `/bin/${tool}` })), async () => ({ PATH: "/bin" }), async sessionId => claudeSessions.has(sessionId));
/** Claude sessions that really started (Claude records them only then). */
const claudeSessions = new Set<string>();
const size = { cols: 100, rows: 30 };

test("Claude runs with files only, writes only in the AI folder and never edits the backend; Codex uses its write sandbox", () => {
  const args = claudeTerminalArgs({ sessionId: "s1", resume: false, backendFolders: ["/code/api"], prompt: "가이드를 읽으세요" });
  assert.deepEqual(args.slice(0, 2), ["--session-id", "s1"]);
  for (const flag of ["--restricted", "--strict-mcp-config"]) assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(args.indexOf("--tools") + 1, args.indexOf("--tools") + 6), ["Read", "Grep", "Glob", "Write", "Edit"]);
  assert.ok(args.join(" ").includes("--add-dir /code/api"));
  assert.ok(args.includes("Edit(//code/api/**)"));
  // Claude matches only Edit rules for files; a Write rule would be ignored with a warning.
  assert.equal(args.some(arg => arg.startsWith("Write(")), false);
  // The prompt comes right after a single-value option, so no list option swallows it.
  assert.deepEqual(args.slice(-3), ["--permission-mode", "acceptEdits", "가이드를 읽으세요"]);
  assert.deepEqual(claudeTerminalArgs({ sessionId: "s1", resume: true, backendFolders: [] }).slice(0, 2), ["--resume", "s1"]);
  assert.deepEqual(codexTerminalArgs({ resume: false, prompt: "p" }), ["--sandbox", "workspace-write", "--ask-for-approval", "on-request", "p"]);
  assert.deepEqual(codexTerminalArgs({ resume: true }), ["resume", "--last", "--sandbox", "workspace-write", "--ask-for-approval", "on-request"]);
  assert.equal(codexTerminalArgs({ resume: false, prompt: "p" }).includes("--add-dir"), false);
});

test("starting writes the guide file, runs the CLI in the AI folder and keeps only the session to resume", async () => {
  const { dir, workspace, backend, scope } = await setup();
  const { runs, spawn } = fakeSpawn();
  const events: ApiAiTerminalEvent[] = [];
  const terminals = service(workspace, spawn, events);
  try {
    const started = await terminals.start({ scope, size });
    const chatDir = path.join(dir, "ai", scope.projectId, "chat");
    assert.deepEqual([started.tool, started.running, started.environmentId], ["claude", true, scope.environmentId]);
    assert.equal(runs[0].file, "/bin/claude");
    assert.equal(runs[0].cwd, chatDir);
    const guideFile = path.join(chatDir, "guide.md");
    assert.equal(runs[0].args.at(-1), openingPrompt(guideFile));
    assert.ok(runs[0].args.join(" ").includes(`--add-dir ${backend}`));
    const guide = await readFile(guideFile, "utf8");
    assert.ok(guide.includes(path.join(chatDir, "scenarios.yaml")) && guide.includes("Checkly가 저장을 감지해 바로 검사"));
    assert.equal(guide.includes("AI 결과 불러오기"), false);
    // Output is forwarded and kept for the screen to replay.
    runs[0].process.output("무엇을 테스트할까요?");
    assert.deepEqual(events.at(-1), { type: "data", projectId: scope.projectId, data: "무엇을 테스트할까요?" });
    assert.equal((await terminals.get(scope.projectId))?.buffer, "무엇을 테스트할까요?");
    terminals.write(scope.projectId, "로그인 확인\r");
    assert.deepEqual(runs[0].typed, ["로그인 확인\r"]);
    // Only the pointer is saved: no output, no conversation.
    const saved = JSON.parse(await readFile(path.join(dir, `ai-terminal-${scope.projectId}.json`), "utf8"));
    assert.deepEqual(Object.keys(saved).sort(), ["environmentId", "sessionId", "startedAt", "tool"]);
    await assert.rejects(terminals.start({ scope, size }), /이미 대화가 있습니다/);
  } finally { terminals.stopAll(); await rm(dir, { recursive: true, force: true }); }
});

test("a save of the result file is announced and checked; clearing stops the CLI and forgets session and result", async () => {
  const { dir, workspace, scope } = await setup();
  const { runs, spawn } = fakeSpawn();
  const events: ApiAiTerminalEvent[] = [];
  const terminals = service(workspace, spawn, events);
  try {
    await terminals.start({ scope, size });
    assert.equal(await workspace.checkAiTerminalResult(scope), null);
    await writeFile(workspace.aiTerminalResultFile(scope.projectId), good);
    for (let tries = 0; tries < 50 && !events.some(event => event.type === "result"); tries++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(events.some(event => event.type === "result" && event.projectId === scope.projectId));
    const checked = await workspace.checkAiTerminalResult(scope);
    assert.deepEqual(checked?.result.drafts.map(draft => [draft.name, draft.issues]), [["로그인", []]]);
    await terminals.clear(scope.projectId);
    assert.equal(runs[0].process.killed, true);
    assert.equal(await terminals.get(scope.projectId), null);
    assert.equal(await workspace.checkAiTerminalResult(scope), null);
    await assert.rejects(readFile(path.join(dir, `ai-terminal-${scope.projectId}.json`), "utf8"), { code: "ENOENT" });
  } finally { terminals.stopAll(); await rm(dir, { recursive: true, force: true }); }
});

test("after a restart the saved session resumes in its CLI and keeps the last result; the chosen AI is used only while installed", async () => {
  const { dir, workspace, scope } = await setup();
  const { runs, spawn } = fakeSpawn();
  try {
    await workspace.saveAiChatSettings(scope.projectId, { ...(await workspace.getAiChatSettings(scope.projectId)), tool: "codex" });
    const first = service(workspace, spawn, [], ["claude", "codex"]);
    assert.equal((await first.start({ scope, size })).tool, "codex");
    assert.equal(runs[0].args.includes("resume"), false);
    await writeFile(workspace.aiTerminalResultFile(scope.projectId), good);
    first.stopAll();
    const restarted = service(workspace, spawn, [], ["claude", "codex"]);
    const restored = await restarted.get(scope.projectId);
    assert.deepEqual([restored?.tool, restored?.running], ["codex", false]);
    await restarted.resume({ scope, size });
    assert.deepEqual(runs[1].args.slice(0, 2), ["resume", "--last"]);
    assert.ok(await workspace.checkAiTerminalResult(scope));
    restarted.stopAll();
    // The session's CLI is gone: resuming says so instead of switching AIs.
    await assert.rejects(service(workspace, spawn, [], ["claude"]).resume({ scope, size }), /Codex를 찾지 못했습니다/);
    await assert.rejects(service(workspace, spawn, [], []).start({ scope: { ...scope }, size }), /이미 대화가 있습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a new session needs a backend folder and an installed AI", async () => {
  const { dir, workspace, scope } = await setup();
  const { spawn } = fakeSpawn();
  try {
    await assert.rejects(service(workspace, spawn, [], []).start({ scope, size }), /Claude Code나 Codex CLI를 찾지 못했습니다/);
    await workspace.saveAiChatSettings(scope.projectId, { folders: {} });
    await assert.rejects(service(workspace, spawn, []).start({ scope, size }), /백엔드 코드 폴더를 먼저 설정하세요/);
    assert.equal(await service(workspace, spawn, []).get(scope.projectId), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a Claude session that ended at the trust question starts again on 이어서 열기; an exit is said in the terminal", async () => {
  const { dir, workspace, scope } = await setup();
  const { runs, spawn } = fakeSpawn();
  const events: ApiAiTerminalEvent[] = [];
  const terminals = service(workspace, spawn, events);
  try {
    await terminals.start({ scope, size });
    const sessionId = runs[0].args[1];
    runs[0].process.exit(0);
    assert.match((await terminals.get(scope.projectId))!.buffer, /Claude가 종료되었습니다/);
    assert.deepEqual(events.slice(-1), [{ type: "exit", projectId: scope.projectId, exitCode: 0 }]);
    // Not recorded by Claude: a fresh start with the same id and the guide prompt.
    await terminals.resume({ scope, size });
    assert.deepEqual(runs[1].args.slice(0, 2), ["--session-id", sessionId]);
    assert.match(runs[1].args.at(-1)!, /가이드 파일/);
    runs[1].process.exit(0);
    // Recorded: a real resume without a prompt.
    claudeSessions.add(sessionId);
    await terminals.resume({ scope, size });
    assert.deepEqual(runs[2].args.slice(0, 2), ["--resume", sessionId]);
    assert.equal(runs[2].args.at(-1), "acceptEdits");
  } finally { terminals.stopAll(); await rm(dir, { recursive: true, force: true }); }
});

test("Claude session lookup finds the session file in any project folder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "checkly-claude-projects-"));
  try {
    await mkdir(path.join(root, "-Users-me-app"), { recursive: true });
    await writeFile(path.join(root, "-Users-me-app", "abc.jsonl"), "{}\n");
    assert.equal(await claudeSessionExists("abc", root), true);
    assert.equal(await claudeSessionExists("missing", root), false);
    assert.equal(await claudeSessionExists("abc", path.join(root, "none")), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the saved marker survives a restart, so the same result is not offered (and its suite saved) again", async () => {
  const { dir, workspace, scope } = await setup();
  const { spawn } = fakeSpawn();
  try {
    const first = service(workspace, spawn, []);
    await first.start({ scope, size });
    await first.markSaved(scope.projectId, { modifiedAt: "2026-10-08T03:10:56.000Z", scenarioId: "s1" });
    first.stopAll();
    assert.deepEqual((await service(workspace, spawn, []).get(scope.projectId))?.saved, { modifiedAt: "2026-10-08T03:10:56.000Z", scenarioId: "s1" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a result whose suite has the name of one saved suite updates that suite instead of adding a copy", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const login = await workspace.saveScenario(scope, good, {});
    const bundle = `${good}---\nsuite: { name: 로그인 흐름, scenarios: [로그인] }\n`;
    assert.equal((await workspace.checkAiScenarios(scope, bundle)).suite?.replaces, undefined);
    const suite = await workspace.saveSuite(scope.projectId, { id: randomUUID(), name: "로그인 흐름", scenarioIds: [login.id], onFailure: "continue" });
    assert.deepEqual((await workspace.checkAiScenarios(scope, bundle)).suite?.replaces, { id: suite.id, updatedAt: suite.updatedAt, onFailure: "continue" });
    // Two suites with that name: nothing to pick, a new one is added.
    await workspace.saveSuite(scope.projectId, { id: randomUUID(), name: "로그인 흐름", scenarioIds: [login.id], onFailure: "stop" });
    assert.equal((await workspace.checkAiScenarios(scope, bundle)).suite?.replaces, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
