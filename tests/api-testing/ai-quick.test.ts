import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { AiQuickService, claudeQuickArgs, codexQuickArgs, readQuickEvent, type QuickSpawn } from "../../src/app/api-testing/main/ai-quick";
import type { ApiAiQuick, ApiAiQuickEvent, ApiAiTool } from "../../src/app/api-testing/shared/workspace";

const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "상점", version: "1" }, paths: {
  "/login": { post: { summary: "로그인", responses: { "200": { description: "성공" } } } },
} });
const good = "name: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n";
const broken = "name: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /nowhere\n";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-quick-"));
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

type Run = { file: string; args: string[]; cwd: string; prompt: Promise<string>; say(event: object): void; close(code?: number): void; killed: boolean };
/** A fake headless CLI: each run is handed to `act`, which plays what the AI does. */
function fakeSpawn(act: (run: Run, index: number) => void | Promise<void>) {
  const runs: Run[] = [];
  const spawn: QuickSpawn = (file, args, options) => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams & EventEmitter;
    const stdout = new PassThrough(), stderr = new PassThrough(), stdin = new PassThrough();
    let input = "";
    const prompt = new Promise<string>(resolve => { stdin.on("data", chunk => { input += chunk; }); stdin.on("end", () => resolve(input)); });
    let closed = false;
    const run: Run = {
      file, args, cwd: options.cwd, prompt, killed: false,
      say: event => stdout.write(`${JSON.stringify(event)}\n`),
      close: (code = 0) => { if (closed) return; closed = true; stdout.end(); setImmediate(() => child.emit("close", code)); },
    };
    Object.assign(child, { stdout, stderr, stdin, kill: () => { run.killed = true; run.close(143); return true; } });
    runs.push(run);
    setImmediate(() => void act(run, runs.length - 1));
    return child;
  };
  return { runs, spawn };
}

const service = (workspace: ApiWorkspace, spawn: QuickSpawn, events: ApiAiQuickEvent[], tools: ApiAiTool[] = ["claude"]) =>
  new AiQuickService(workspace, event => events.push(event), spawn, async () => tools.map(tool => ({ tool, path: `/bin/${tool}` })), async () => ({ PATH: "/bin" }));

async function until(events: ApiAiQuickEvent[], done: (quick: ApiAiQuick) => boolean): Promise<ApiAiQuick> {
  for (let i = 0; i < 400; i += 1) {
    const last = events.at(-1)?.quick;
    if (last && done(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`timed out: ${JSON.stringify(events.at(-1))}`);
}

test("headless args: Claude reads files only and never edits the backend; Codex resumes its thread with the write sandbox", () => {
  const claude = claudeQuickArgs({ sessionId: "s1", resume: false, backendFolders: ["/code/api"] });
  assert.deepEqual(claude.slice(0, 6), ["-p", "--output-format", "stream-json", "--verbose", "--session-id", "s1"]);
  assert.ok(claude.includes("Edit(//code/api/**)"));
  assert.deepEqual(claude.slice(-2), ["--permission-mode", "acceptEdits"]);
  assert.deepEqual(claudeQuickArgs({ sessionId: "s1", resume: true, backendFolders: [] }).slice(4, 6), ["--resume", "s1"]);
  assert.deepEqual(codexQuickArgs({}), ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-"]);
  assert.deepEqual(codexQuickArgs({ threadId: "t1" }).slice(0, 2), ["exec", "resume"]);
  assert.deepEqual(codexQuickArgs({ threadId: "t1" }).slice(-2), ["t1", "-"]);
});

test("CLI events become a progress line, the last answer and the Codex thread", () => {
  assert.deepEqual(readQuickEvent("claude", JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/code/api/UserController.java" } }] } })), { progress: "읽는 중: UserController.java" });
  assert.deepEqual(readQuickEvent("claude", JSON.stringify({ type: "result", is_error: false, result: "로그인 시나리오를 만들었습니다." })), { note: "로그인 시나리오를 만들었습니다." });
  assert.deepEqual(readQuickEvent("claude", JSON.stringify({ type: "result", is_error: true, result: "Credit balance is too low" })), { error: "Credit balance is too low" });
  assert.deepEqual(readQuickEvent("codex", JSON.stringify({ type: "thread.started", thread_id: "t1" })), { sessionId: "t1" });
  assert.deepEqual(readQuickEvent("codex", JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "/bin/zsh -lc 'rg login src'" } })), { progress: "확인 중: rg login src" });
  assert.deepEqual(readQuickEvent("codex", JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "만들었습니다" } })), { note: "만들었습니다" });
  assert.deepEqual(readQuickEvent("codex", "not json"), {});
});

test("a request runs the AI in its own folder with the guide, then shows the checked result and the AI's answer", async () => {
  const { dir, workspace, scope } = await setup();
  const { runs, spawn } = fakeSpawn(async run => {
    const prompt = await run.prompt;
    const guideFile = /가이드 파일 (\S+) 을/.exec(prompt)![1]!;
    const guide = await readFile(guideFile, "utf8");
    assert.match(guide, /질문하지 말고 바로 작성합니다/);
    const resultFile = /결과를 파일 (\S+) 에 저장/.exec(guide)![1]!;
    run.say({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/code/Login.java" } }] } });
    await writeFile(resultFile, good);
    run.say({ type: "result", is_error: false, result: "로그인 시나리오 1개를 만들었습니다." });
    run.close();
  });
  const events: ApiAiQuickEvent[] = [];
  const quick = service(workspace, spawn, events);
  try {
    const started = await quick.start({ scope, request: "로그인 테스트" });
    assert.equal(started.status, "running");
    const done = await until(events, value => value.status !== "running");
    assert.equal(done.status, "done", done.error);
    assert.equal(done.turns[0]?.note, "로그인 시나리오 1개를 만들었습니다.");
    assert.equal(done.check?.result.drafts[0]?.name, "로그인");
    assert.ok(events.some(event => event.quick?.progress === "읽는 중: Login.java"));
    assert.equal(path.basename(runs[0]!.cwd), "quick");
    assert.match(await runs[0]!.prompt, /요청:\n로그인 테스트/);
    // The terminal's folder is left alone.
    assert.equal(await stat(path.join(path.dirname(runs[0]!.cwd), "chat", "scenarios.yaml")).then(() => true, () => false), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("problems go back to the same session on their own, twice at most; a 수정 요청 resumes it", async () => {
  const { dir, workspace, scope } = await setup();
  let resultFile = "";
  const { runs, spawn } = fakeSpawn(async (run, index) => {
    const prompt = await run.prompt;
    if (index === 0) resultFile = /결과를 파일 (\S+) 에 저장/.exec(await readFile(/가이드 파일 (\S+) 을/.exec(prompt)![1]!, "utf8"))![1]!;
    // Always broken until the 수정 요청.
    await writeFile(resultFile, index < 3 ? broken : good);
    run.say({ type: "result", is_error: false, result: `${index}번째 답` });
    run.close();
  });
  const events: ApiAiQuickEvent[] = [];
  const quick = service(workspace, spawn, events);
  try {
    await quick.start({ scope, request: "로그인" });
    const done = await until(events, value => value.status !== "running");
    assert.equal(runs.length, 3);
    assert.equal(done.status, "done");
    assert.equal(done.fixes, 2);
    assert.ok(done.check?.result.drafts[0]?.issues.length);
    assert.match(await runs[1]!.prompt, /Checkly 검사에서 아래 문제가 나왔습니다/);
    assert.ok(runs[1]!.args.includes("--resume"));
    const sessionId = runs[0]!.args[runs[0]!.args.indexOf("--session-id") + 1];
    assert.equal(runs[1]!.args[runs[1]!.args.indexOf("--resume") + 1], sessionId);

    events.length = 0;
    const revised = await quick.revise(scope.projectId, "API 경로를 고쳐 주세요");
    assert.deepEqual(revised.turns.map(turn => turn.request), ["로그인", "API 경로를 고쳐 주세요"]);
    assert.equal(revised.turns[0]?.note, "2번째 답");
    const fixed = await until(events, value => value.status !== "running");
    assert.equal(fixed.status, "done");
    assert.equal(fixed.fixes, 0);
    assert.deepEqual(fixed.turns.map(turn => turn.note), ["2번째 답", "3번째 답"]);
    assert.equal(fixed.check?.result.drafts[0]?.issues.length, 0);
    assert.match(await runs[3]!.prompt, /이어서 요청:\nAPI 경로를 고쳐 주세요/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Codex resumes the thread it reported; a run without a saved result or with an error fails with a message", async () => {
  const { dir, workspace, scope } = await setup();
  const { runs, spawn } = fakeSpawn(async (run, index) => {
    await run.prompt;
    if (index === 0) {
      run.say({ type: "thread.started", thread_id: "thread-1" });
      run.say({ type: "item.completed", item: { type: "agent_message", text: "무엇을 테스트할까요?" } });
      run.close();
    } else {
      run.say({ type: "turn.failed", error: { message: "usage limit" } });
      run.close(1);
    }
  });
  const events: ApiAiQuickEvent[] = [];
  const quick = service(workspace, spawn, events, ["codex"]);
  try {
    await quick.start({ scope, request: "로그인" });
    const first = await until(events, value => value.status !== "running");
    assert.equal(first.status, "failed");
    assert.equal(first.error, "AI가 시나리오를 만들지 못했습니다");
    assert.equal(first.turns[0]?.note, "무엇을 테스트할까요?");
    events.length = 0;
    await quick.revise(scope.projectId, "로그인 성공만");
    const second = await until(events, value => value.status !== "running");
    assert.equal(second.error, "usage limit");
    assert.deepEqual(runs[1]!.args.slice(-2), ["thread-1", "-"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("중단 stops the CLI; 새로 만들기 forgets the session and its result; a second start while running is refused", async () => {
  const { dir, workspace, scope } = await setup();
  const { runs, spawn } = fakeSpawn(() => undefined);
  const events: ApiAiQuickEvent[] = [];
  const quick = service(workspace, spawn, events);
  try {
    await quick.start({ scope, request: "로그인" });
    await assert.rejects(quick.start({ scope, request: "또" }), /이미 만들고 있습니다/);
    while (!runs.length) await new Promise(resolve => setTimeout(resolve, 5));
    await quick.stop(scope.projectId);
    assert.equal(runs[0]!.killed, true);
    const stopped = await until(events, value => value.status === "stopped");
    assert.equal(stopped.progress, "");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await quick.get(scope.projectId))?.status, "stopped");
    const resultFile = workspace.aiTerminalResultFile(scope.projectId, "quick");
    await writeFile(resultFile, good);
    await quick.clear(scope.projectId);
    assert.equal(await quick.get(scope.projectId), null);
    assert.equal(await stat(resultFile).then(() => true, () => false), false);
    await assert.rejects(quick.start({ scope, request: "  " }), /요청할 내용을 적어 주세요/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("AI에게 요청 with a failed run sends the saved YAML without its id, where it failed and the masked response; the request names the scenario", async () => {
  const { dir, workspace, scope, project } = await setup();
  const saved = await workspace.saveScenario(scope, good, {});
  await workspace.setGlobal({ projectId: scope.projectId }, "accessToken", "secret-token-123");
  const { runs, spawn } = fakeSpawn(async run => { await run.prompt; run.close(); });
  const events: ApiAiQuickEvent[] = [];
  const quick = service(workspace, spawn, events);
  try {
    const started = await quick.start({ scope, request: "주소만 바꾸면 돼요", about: { scenarioId: saved.id, failures: ["1단계 '로그인' 실패 · HTTP 오류 상태 · HTTP 400"], response: "{\"token\":\"secret-token-123\",\"message\":\"주소 필수\"}" } });
    assert.deepEqual(started.turns, [{ request: "‘로그인’ 고치기 · 주소만 바꾸면 돼요", note: "" }]);
    await until(events, value => value.status !== "running");
    const prompt = await runs[0]!.prompt;
    assert.match(prompt, /기존 시나리오 '로그인'에 대한 요청입니다. 이 시나리오를 실행했더니 실패했습니다/);
    assert.match(prompt, /- 1단계 '로그인' 실패 · HTTP 오류 상태 · HTTP 400/);
    assert.match(prompt, /사용자 요청:\n주소만 바꾸면 돼요/);
    assert.match(prompt, /api: POST \/login/);
    assert.doesNotMatch(prompt, /^id: /m);
    assert.match(prompt, /주소 필수/);
    assert.doesNotMatch(prompt, /secret-token-123/);
    // Without a message or response only the YAML and the failure go.
    await quick.clear(scope.projectId);
    await quick.start({ scope, request: "", about: { scenarioId: saved.id, failures: ["1단계 '로그인' 실패"] } });
    await until(events, value => value.status !== "running" && value.turns[0]?.request === "‘로그인’ 고치기");
    const plain = await runs[1]!.prompt;
    assert.doesNotMatch(plain, /사용자 요청|응답\(앞부분\)/);
    await assert.rejects(quick.start({ scope, request: "", about: { scenarioId: "missing", failures: ["x"] } }), /고칠 시나리오를 찾지 못했습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a result file without any scenario (the AI wrote only why it could not) is a plain failure, not a check error", async () => {
  const { dir, workspace, scope } = await setup();
  const { spawn } = fakeSpawn(async run => {
    const prompt = await run.prompt;
    const resultFile = /결과를 파일 (\S+) 에 저장/.exec(await readFile(/가이드 파일 (\S+) 을/.exec(prompt)![1]!, "utf8"))![1]!;
    await writeFile(resultFile, "로컬 로그인 API가 명세에 없어 만들 수 없습니다.\n");
    run.say({ type: "result", is_error: false, result: "명세를 다시 가져와 주세요." });
    run.close();
  });
  const events: ApiAiQuickEvent[] = [];
  const quick = service(workspace, spawn, events);
  try {
    await quick.start({ scope, request: "로컬 로그인" });
    const done = await until(events, value => value.status !== "running");
    assert.equal(done.status, "failed");
    assert.equal(done.error, "AI가 시나리오를 만들지 못했습니다");
    assert.equal(done.check, undefined);
    assert.equal(done.turns[0]?.note, "명세를 다시 가져와 주세요.");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a question about a saved scenario is answered without a result, which is not a failure; it needs words or a failure", async () => {
  const { dir, workspace, scope } = await setup();
  const saved = await workspace.saveScenario(scope, good, {});
  const { runs, spawn } = fakeSpawn(async run => { await run.prompt; run.say({ type: "result", is_error: false, result: "로그인 단계는 토큰을 만들기 위한 것입니다." }); run.close(); });
  const events: ApiAiQuickEvent[] = [];
  const quick = service(workspace, spawn, events);
  try {
    await assert.rejects(quick.start({ scope, request: " ", about: { scenarioId: saved.id } }), /요청할 내용을 적어 주세요/);
    const started = await quick.start({ scope, request: "이 단계는 왜 있어?", about: { scenarioId: saved.id } });
    assert.equal(started.turns[0]?.request, "‘로그인’에 대해 · 이 단계는 왜 있어?");
    const done = await until(events, value => value.status !== "running");
    assert.equal(done.status, "done");
    assert.equal(done.error, undefined);
    assert.equal(done.check, undefined);
    assert.equal(done.turns[0]?.note, "로그인 단계는 토큰을 만들기 위한 것입니다.");
    const prompt = await runs[0]!.prompt;
    assert.match(prompt, /질문이면 결과 파일에 쓰지 말고 답만 하세요/);
    assert.doesNotMatch(prompt, /실행했더니 실패/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
