import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { AiChatService, maxAutoFixes } from "../../src/app/api-testing/main/ai-chat";
import { claudeArgs, codexArgs, runAiTurn, type AiTurn } from "../../src/app/api-testing/main/ai-cli";
import type { ApiAiTool } from "../../src/app/api-testing/shared/workspace";
import { problemReport } from "../../src/app/api-testing/shared/ai-problem-report";
import { splitAiBundle, yamlBlocks } from "../../src/app/api-testing/main/ai-context";

const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "상점", version: "1" }, paths: {
  "/login": { post: { summary: "로그인", responses: { "200": { description: "성공" } } } },
  "/items/{id}": { get: { summary: "상품 조회", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "성공" } } } },
} });
const good = "계획대로 작성했습니다.\n```yaml\nname: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n```\n";
const broken = "```yaml\nname: 상품 조회\nserver: 상점\nsteps:\n  - name: 상품 조회\n    api: GET /missing\n```";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-chat-"));
  const workspace = new ApiWorkspace(dir);
  const serverId = randomUUID(), adminId = randomUUID(), environmentId = randomUUID();
  const project = { id: randomUUID(), name: "AI", servers: [{ id: serverId, name: "상점" }, { id: adminId, name: "관리자" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://shop.example.com", [adminId]: "https://admin.example.com" } }] };
  await workspace.saveProject(project);
  await workspace.importSpec({ projectId: project.id, serverId, environmentId }, spec);
  // The chat needs a backend folder.
  const backend = path.join(dir, "backend");
  await mkdir(backend);
  await workspace.saveAiChatSettings(project.id, { folders: { [serverId]: [backend] } });
  return { dir, workspace, project, serverId, adminId, backend, scope: { projectId: project.id, environmentId } };
}

/** A chat service with fixed installed CLIs instead of looking at this PC. */
const service = (workspace: ApiWorkspace, run: (turn: AiTurn) => Promise<string>, tools: ApiAiTool[] = ["claude"]) => new AiChatService(workspace, run, async () => tools);

/** A fake AI: answers from a list and records every turn. */
function fakeAi(answers: Array<string | Error>) {
  const turns: AiTurn[] = [];
  return { turns, run: async (turn: AiTurn) => {
    turns.push(turn);
    const answer = answers.shift() ?? "네.";
    if (answer instanceof Error) throw answer;
    turn.onEvent?.({ type: "tool", detail: "Read UserController.java" });
    return answer;
  } };
}

test("chat settings: several backend folders per server (absolute only), the AI; kept out of the project and removed with it", async () => {
  const { dir, workspace, project, serverId, adminId } = await setup();
  try {
    const member = path.join(dir, "member-api"), common = path.join(dir, "common-lib");
    const saved = await workspace.saveAiChatSettings(project.id, { folders: { [serverId]: [member, common, member], [adminId]: [], [randomUUID()]: [common] }, tool: "codex" });
    assert.deepEqual(saved, { folders: { [serverId]: [member, common] }, tool: "codex" });
    assert.deepEqual(await new ApiWorkspace(dir).getAiChatSettings(project.id), saved);
    await assert.rejects(workspace.saveAiChatSettings(project.id, { folders: { [serverId]: ["relative/path"] } }), /절대 경로/);
    await assert.rejects(workspace.saveAiChatSettings(project.id, { folders: {}, tool: "gemini" }));
    assert.equal(JSON.stringify(await workspace.listProjects()).includes("member-api"), false);
    await workspace.deleteProject(project.id);
    assert.equal((await readFile(path.join(dir, "ai-chat-settings.json"), "utf8")).includes(project.id), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("chat setup runs in the first backend folder, reads the rest and the API file, and plans before writing", async () => {
  const { dir, workspace, project, serverId, adminId, scope } = await setup();
  try {
    const member = path.join(dir, "member-api"), common = path.join(dir, "common-lib"), admin = path.join(dir, "admin-api");
    for (const folder of [member, common, admin]) await mkdir(folder);
    await workspace.saveAiChatSettings(project.id, { folders: { [serverId]: [member, common], [adminId]: [admin] } });
    const setup = await workspace.aiChatSetup({ scope });
    const aiDir = path.join(dir, "ai", project.id, "chat");
    assert.equal(setup.cwd, member);
    assert.deepEqual(setup.readDirs, [common, admin, aiDir]);
    assert.equal(setup.folderCount, 3);
    assert.ok(setup.prompt.includes(`- 상점: ${member}, ${common}`) && setup.prompt.includes(`- 관리자: ${admin}`));
    assert.ok(setup.prompt.includes("계획을 제안하고 사용자의 확인을 기다리세요") && setup.prompt.includes("yaml 코드 블록 하나로 출력"));
    assert.equal(setup.prompt.includes("AI 결과 불러오기"), false);
    assert.equal(setup.prompt.includes("scenarios.yaml"), false);
    // Without folders the chat does not start (the copy-and-paste guide is used instead).
    await workspace.saveAiChatSettings(project.id, { folders: {} });
    await assert.rejects(workspace.aiChatSetup({ scope }), /백엔드 코드 폴더를 먼저 설정하세요/);
    await workspace.saveAiChatSettings(project.id, { folders: { [serverId]: [path.join(dir, "gone")] } });
    await assert.rejects(workspace.aiChatSetup({ scope }), /백엔드 폴더를 찾을 수 없습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a chat keeps one Claude session: the guide opens it, later turns resume it", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["무엇을 테스트할까요?", "시나리오 2개로 나눌게요. 괜찮을까요?"]);
    const chats = service(workspace, ai.run);
    const chat = await chats.start({ scope });
    assert.equal(chat.tool, "claude");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns[0].resume, false);
    assert.ok(ai.turns[0].prompt.includes("# Checkly API 시나리오 작성 가이드") && ai.turns[0].prompt.includes("먼저 질문하세요"));
    await chats.send(scope.projectId, chat.id, "로그인 후 상품 조회");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns[1].resume, true);
    assert.equal(ai.turns[1].sessionId, ai.turns[0].sessionId);
    assert.equal(ai.turns[1].prompt, "로그인 후 상품 조회");
    // The guide points at the saved-state file, rewritten before every turn instead of resending the guide.
    const stateFile = path.join(dir, "ai", scope.projectId, "chat", "project-state.json");
    assert.ok(ai.turns[0].prompt.includes(stateFile) && ai.turns[0].prompt.includes("메시지를 보낼 때마다 이 파일을 최신으로 갱신"));
    await workspace.saveScenario(scope, "name: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n", {});
    await chats.send(scope.projectId, chat.id, "방금 저장한 것도 봐 주세요");
    await chats.idle(scope.projectId, chat.id);
    assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")).scenarios.map((item: { name: string }) => item.name), ["로그인"]);
    assert.equal(ai.turns[2].prompt, "방금 저장한 것도 봐 주세요");
    assert.deepEqual((await chats.get(scope.projectId))?.messages.map(message => message.role), ["checkly", "assistant", "user", "assistant", "user", "assistant"]);
    assert.deepEqual((await chats.get(scope.projectId))?.messages[1].tools, ["Read UserController.java"]);
    // Only the session pointer is on disk: no messages, guide or results.
    const file = JSON.parse(await readFile(path.join(dir, `ai-chat-${scope.projectId}.json`), "utf8"));
    assert.deepEqual(Object.keys(file).sort(), ["cliSessionId", "createdAt", "cwd", "environmentId", "id", "readDirs", "started", "title", "tool", "updatedAt"]);
    assert.equal(JSON.stringify(file).includes("로그인 후 상품 조회") && JSON.stringify(file).includes("무엇을 테스트할까요"), false);
    // After a restart the chat resumes the same CLI session with a note instead of the old messages.
    const restarted = service(workspace, ai.run);
    const saved = await restarted.get(scope.projectId);
    assert.deepEqual(saved?.messages.map(message => message.role), ["checkly"]);
    assert.match(saved!.messages[0].text, /이전 대화를 이어갑니다/);
    assert.equal(saved?.title, "로그인 후 상품 조회");
    assert.equal(JSON.stringify(saved).includes(ai.turns[0].sessionId), false);
    assert.equal((await restarted.start({ scope })).id, chat.id);
    await restarted.send(scope.projectId, chat.id, "이어서");
    await restarted.idle(scope.projectId, chat.id);
    assert.deepEqual([ai.turns[3].resume, ai.turns[3].sessionId, ai.turns[3].prompt], [true, ai.turns[0].sessionId, "이어서"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("YAML answers are checked; problems go back to the AI on their own until fixed", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["질문", broken, good]);
    const chats = service(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    await chats.send(scope.projectId, chat.id, "좋아요, 작성해 주세요");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns.length, 3);
    assert.match(ai.turns[2].prompt, /Checkly 검사에서 아래 문제가 나왔습니다[\s\S]*yaml 코드 블록 하나로 다시 출력/);
    const messages = (await chats.get(scope.projectId))!.messages;
    const last = messages.at(-1)!;
    assert.equal(last.role, "checkly");
    assert.match(last.text, /검사를 통과했습니다/);
    assert.deepEqual(last.result?.drafts.map(draft => [draft.name, draft.issues]), [["로그인", []]]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test(`automatic fixes stop after ${maxAutoFixes} tries; failures and a failed first turn are recoverable`, async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi([new Error("AI 오류: Not logged in"), "질문", ...Array(maxAutoFixes + 1).fill(broken)]);
    const chats = service(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    let messages = (await chats.get(scope.projectId))!.messages;
    assert.equal(messages.at(-1)?.error, true);
    // Nothing came back, so the next turn opens a fresh session and still carries the guide.
    await chats.send(scope.projectId, chat.id, "다시 시작");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns[1].resume, false);
    assert.notEqual(ai.turns[1].sessionId, ai.turns[0].sessionId);
    assert.ok(ai.turns[1].prompt.includes("# Checkly API 시나리오 작성 가이드") && ai.turns[1].prompt.endsWith("다시 시작"));
    await chats.send(scope.projectId, chat.id, "작성해 주세요");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns.length, 2 + 1 + maxAutoFixes);
    messages = (await chats.get(scope.projectId))!.messages;
    assert.match(messages.at(-1)!.text, new RegExp(`자동 수정 ${maxAutoFixes}번 뒤에도 문제가 남았습니다`));
    assert.ok(messages.at(-1)!.result?.drafts[0].issues.length);
    await assert.rejects(chats.send(scope.projectId, chat.id, " "), /메시지를 입력하세요/);
    const reset = await chats.reset({ scope }, chat.id);
    await chats.idle(scope.projectId, reset.id);
    assert.notEqual(reset.id, chat.id);
    assert.deepEqual((await chats.get(scope.projectId))!.messages.map(message => message.role), ["checkly", "assistant"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Claude runs read-only and isolated, streams text and tool calls, and explains login failures", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-fake-claude-"));
  const previous = process.env.CHECKLY_AI_CLI_PATH;
  try {
    const args = claudeArgs({ sessionId: "s1", resume: true, readDirs: ["/a", "/b"] });
    assert.deepEqual(args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 2), ["--resume", "s1"]);
    for (const flag of ["--restricted", "--strict-mcp-config", "--include-partial-messages"]) assert.ok(args.includes(flag), flag);
    assert.deepEqual(args.slice(args.indexOf("--tools") + 1, args.indexOf("--tools") + 4), ["Read", "Grep", "Glob"]);
    assert.ok(args.join(" ").includes("--add-dir /a --add-dir /b") && !args.includes("--model") && !args.includes("--effort"));
    assert.ok(claudeArgs({ sessionId: "s2", resume: false, readDirs: [] }).includes("--session-id"));
    const fake = path.join(dir, "claude.mjs");
    await writeFile(fake, `#!/usr/bin/env node
let input = ""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => {
  const out = line => process.stdout.write(JSON.stringify(line) + "\\n");
  if (input === "fail") { out({ type: "result", is_error: true, result: "Not logged in · Please run /login" }); process.exit(1); }
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "안녕" } } });
  out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a/User.java" } }] } });
  out({ type: "result", is_error: false, result: "안녕하세요 " + process.cwd() });
});
`);
    await chmod(fake, 0o755);
    process.env.CHECKLY_AI_CLI_PATH = fake;
    const events: unknown[] = [];
    const answer = await runAiTurn({ tool: "claude", sessionId: "s1", resume: false, prompt: "hi", cwd: dir, readDirs: [], onEvent: event => events.push(event) });
    assert.ok(answer.startsWith("안녕하세요") && answer.includes(path.basename(dir)));
    assert.deepEqual(events, [{ type: "text", text: "안녕" }, { type: "tool", detail: "Read /a/User.java" }]);
    await assert.rejects(runAiTurn({ tool: "claude", sessionId: "s1", resume: false, prompt: "fail", cwd: dir, readDirs: [] }), /Not logged in[\s\S]*해결: 터미널에서 claude를 실행한 뒤 \/login/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runAiTurn({ tool: "claude", sessionId: "s1", resume: false, prompt: "hi", cwd: dir, readDirs: [], signal: controller.signal }), /중단/);
  } finally {
    if (previous === undefined) delete process.env.CHECKLY_AI_CLI_PATH; else process.env.CHECKLY_AI_CLI_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("problem reports tell the AI how to answer: the exchange file or a chat code block", () => {
  const result = { drafts: [{ id: "a", name: "조회", yaml: "", stepCount: 1, issues: ["API를 찾을 수 없습니다"], notices: [], executionIssues: [] }], suite: null };
  assert.match(problemReport(result), /같은 결과 파일에 다시 저장하세요/);
  assert.match(problemReport(result, "chat"), /yaml 코드 블록 하나로 다시 출력하세요/);
});

test("Korean text split across output chunks is decoded whole", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-fake-claude-"));
  const previous = process.env.CHECKLY_AI_CLI_PATH;
  try {
    const fake = path.join(dir, "claude.mjs");
    // "한" is 3 bytes in UTF-8; the line is written in two chunks that cut through it.
    await writeFile(fake, `#!/usr/bin/env node
process.stdin.resume(); process.stdin.on("end", () => {
  const line = Buffer.from(JSON.stringify({ type: "result", is_error: false, result: "한글 답변" }) + "\\n");
  const cut = line.indexOf(Buffer.from("한")) + 1;
  process.stdout.write(line.subarray(0, cut));
  setTimeout(() => process.stdout.write(line.subarray(cut)), 50);
});
`);
    await chmod(fake, 0o755);
    process.env.CHECKLY_AI_CLI_PATH = fake;
    assert.equal(await runAiTurn({ tool: "claude", sessionId: "s1", resume: false, prompt: "hi", cwd: dir, readDirs: [] }), "한글 답변");
  } finally {
    if (previous === undefined) delete process.env.CHECKLY_AI_CLI_PATH; else process.env.CHECKLY_AI_CLI_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("only YAML results are checked: a plan with a folder tree or code sample is just an answer", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    assert.deepEqual(yamlBlocks("계획\n```\nsrc/\n  UserController.java\n```\n```java\nclass A {}\n```"), []);
    assert.equal(yamlBlocks("```\nname: x\nsteps:\n  - api: GET /a\n```\n```yml\nsuite: {name: s, scenarios: [x]}\n```").length, 2);
    // Stray blocks next to the result are not read as broken scenarios.
    assert.deepEqual(splitAiBundle(`폴더\n\`\`\`\nsrc/\n\`\`\`\n${good}`).scenarios.length, 1);
    const ai = fakeAi(["계획입니다.\n```\nmember-api/\n  LoginController.java\n```\n이대로 할까요?"]);
    const chats = service(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns.length, 1);
    assert.deepEqual((await chats.get(scope.projectId))!.messages.map(message => message.role), ["checkly", "assistant"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("stopping while Checkly checks says it was stopped, not that fixes ran out", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["질문", broken]);
    let chatId = "";
    // The user presses stop right after the YAML answer arrives, while Checkly checks it.
    const chats: AiChatService = service(workspace, async turn => { const answer = await ai.run(turn); if (answer === broken) void chats.cancel(scope.projectId, chatId); return answer; });
    const chat = await chats.start({ scope });
    chatId = chat.id;
    await chats.idle(scope.projectId, chat.id);
    await chats.send(scope.projectId, chat.id, "작성해 주세요");
    await chats.idle(scope.projectId, chat.id);
    const last = (await chats.get(scope.projectId))!.messages.at(-1)!;
    assert.equal(ai.turns.length, 2);
    assert.match(last.text, /중단했습니다/);
    assert.ok(last.result?.drafts[0].issues.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a project cannot be deleted while its chat answers; after deletion its chats are gone; quitting stops every chat", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const chats = service(workspace, turn => new Promise((_resolve, reject) => {
      turn.signal?.addEventListener("abort", () => reject(new Error("AI 응답을 중단했습니다")), { once: true });
    }));
    const chat = await chats.start({ scope });
    const remove = (projectId: string) => workspace.deleteProject(projectId);
    await assert.rejects(chats.deleteProject(scope.projectId, remove), /AI가 답하는 중에는 프로젝트를 삭제할 수 없습니다/);
    assert.equal((await workspace.listProjects()).length, 1);
    await chats.cancel(scope.projectId, chat.id);
    await chats.idle(scope.projectId, chat.id);
    await chats.deleteProject(scope.projectId, remove);
    await assert.rejects(readFile(path.join(dir, `ai-chat-${scope.projectId}.json`), "utf8"), { code: "ENOENT" });
    assert.equal(await chats.get(scope.projectId), null);

    const other = await setup();
    try {
      const quitting = service(other.workspace, turn => new Promise((_resolve, reject) => turn.signal?.addEventListener("abort", () => reject(new Error("AI 응답을 중단했습니다")), { once: true })));
      const running = await quitting.start({ scope: other.scope });
      quitting.cancelAll();
      await quitting.idle(other.scope.projectId, running.id);
      assert.match((await quitting.get(other.scope.projectId))!.messages.at(-1)!.text, /중단/);
    } finally { await rm(other.dir, { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Codex runs read-only without the user's config, reports its thread id and answers with its last message", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-fake-codex-"));
  const previous = process.env.CHECKLY_CODEX_CLI_PATH;
  try {
    const first = codexArgs({ sessionId: "", resume: false });
    assert.deepEqual(first.slice(0, 3), ["exec", "--sandbox", "read-only"]);
    for (const flag of ["--json", "--ignore-user-config", "--ignore-rules", 'sandbox_mode="read-only"']) assert.ok(first.includes(flag), flag);
    assert.ok(!first.join(" ").includes("model_reasoning_effort") && !first.includes("-m") && first.at(-1) === "-");
    assert.deepEqual(codexArgs({ sessionId: "t1", resume: true }).slice(0, 3), ["exec", "resume", "t1"]);
    const fake = path.join(dir, "codex.mjs");
    await writeFile(fake, `#!/usr/bin/env node
let input = ""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => {
  const out = line => process.stdout.write(JSON.stringify(line) + "\\n");
  out({ type: "thread.started", thread_id: "t-123" });
  if (input === "fail") { out({ type: "turn.failed", error: { message: JSON.stringify({ error: { message: "The 'x' model is not supported" } }) } }); process.exit(1); }
  out({ type: "item.completed", item: { type: "error", message: "warning only" } });
  out({ type: "item.completed", item: { type: "agent_message", text: "코드를 확인하겠습니다." } });
  out({ type: "item.started", item: { type: "command_execution", command: "/bin/zsh -lc 'rg Login src'" } });
  out({ type: "item.completed", item: { type: "agent_message", text: "질문: " + process.argv.slice(2).join(" ") } });
  out({ type: "turn.completed", usage: {} });
});
`);
    await chmod(fake, 0o755);
    process.env.CHECKLY_CODEX_CLI_PATH = fake;
    const events: unknown[] = [];
    const answer = await runAiTurn({ tool: "codex", sessionId: "", resume: false, prompt: "hi", cwd: dir, readDirs: [], onEvent: event => events.push(event) });
    assert.ok(answer.startsWith("질문: exec --sandbox read-only"));
    assert.deepEqual(events.slice(0, 3), [{ type: "session", sessionId: "t-123" }, { type: "text", text: "코드를 확인하겠습니다." }, { type: "tool", detail: "rg Login src" }]);
    await assert.rejects(runAiTurn({ tool: "codex", sessionId: "t-123", resume: true, prompt: "fail", cwd: dir, readDirs: [] }), /model is not supported[\s\S]*해결: 터미널에서 codex CLI를 업데이트/);
    // Only the fake Codex is "installed" here.
    await assert.rejects(runAiTurn({ tool: "claude", sessionId: "s", resume: false, prompt: "hi", cwd: dir, readDirs: [] }), /Claude Code가 이 PC에 설치되어 있지 않습니다/);
  } finally {
    if (previous === undefined) delete process.env.CHECKLY_CODEX_CLI_PATH; else process.env.CHECKLY_CODEX_CLI_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a Codex chat keeps the thread id the CLI gave; the chosen AI is used only while it is installed", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const turns: AiTurn[] = [];
    const run = async (turn: AiTurn) => { turns.push(turn); if (!turn.resume) turn.onEvent?.({ type: "session", sessionId: "thread-1" }); return "무엇을 테스트할까요?"; };
    await workspace.saveAiChatSettings(scope.projectId, { ...(await workspace.getAiChatSettings(scope.projectId)), tool: "codex" });
    const chats = service(workspace, run, ["claude", "codex"]);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    assert.equal(chat.tool, "codex");
    assert.match(chat.messages[0].text, /가이드를 Codex에 전달했습니다/);
    assert.deepEqual([turns[0].tool, turns[0].sessionId, turns[0].resume], ["codex", "", false]);
    await chats.send(scope.projectId, chat.id, "로그인");
    await chats.idle(scope.projectId, chat.id);
    assert.deepEqual([turns[1].sessionId, turns[1].resume], ["thread-1", true]);
    // Codex chosen but no longer installed: resetting uses the installed CLI.
    const fallback = service(workspace, run, ["claude"]);
    const other = await fallback.reset({ scope }, chat.id);
    await fallback.idle(scope.projectId, other.id);
    assert.equal(other.tool, "claude");
    await assert.rejects(service(workspace, run, []).reset({ scope }, other.id), /Claude Code나 Codex CLI를 찾지 못했습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

for (const [chosen, fallback] of [["codex", "claude"], ["claude", "codex"]] as const) {
  test(`starting and resetting with ${fallback} instead of missing ${chosen} keep the saved choice`, async () => {
    const { dir, workspace, scope } = await setup();
    try {
      const settings = { ...(await workspace.getAiChatSettings(scope.projectId)), tool: chosen };
      await workspace.saveAiChatSettings(scope.projectId, settings);
      const ai = fakeAi(["첫 질문", "새 질문"]);
      const chats = service(workspace, ai.run, [fallback]);
      const original = await chats.start({ scope });
      await chats.idle(scope.projectId, original.id);
      const reset = await chats.reset({ scope }, original.id);
      await chats.idle(scope.projectId, reset.id);
      assert.deepEqual([original.tool, reset.tool], [fallback, fallback]);
      assert.deepEqual(ai.turns.map(turn => turn.tool), [fallback, fallback]);
      assert.deepEqual(await workspace.getAiChatSettings(scope.projectId), settings);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test("reset starts a fresh Claude session with the current environment and settings while keeping saved scenarios", async () => {
  const { dir, workspace, project, scope, serverId } = await setup();
  try {
    const ai = fakeAi(["처음 질문", good, "새 질문"]);
    const chats = service(workspace, ai.run);
    const original = await chats.start({ scope });
    await chats.idle(scope.projectId, original.id);
    await chats.send(scope.projectId, original.id, "로그인 작성");
    await chats.idle(scope.projectId, original.id);
    const scenario = await workspace.saveScenario(scope, "name: 저장한 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n", {});
    const environmentId = randomUUID();
    await workspace.saveProject({ ...project, environments: [...project.environments, { ...project.environments[0], id: environmentId, name: "qa" }] });
    const nextScope = { projectId: scope.projectId, environmentId };
    await workspace.importSpec({ ...nextScope, serverId }, spec);
    const reset = await chats.reset({ scope: nextScope }, original.id);
    await chats.idle(scope.projectId, reset.id);
    assert.notEqual(reset.id, original.id);
    assert.equal(reset.environmentId, environmentId);
    assert.equal(ai.turns[2].resume, false);
    assert.notEqual(ai.turns[2].sessionId, ai.turns[0].sessionId);
    assert.match(ai.turns[2].prompt, /Checkly API 시나리오 작성 가이드/);
    const current = (await chats.get(scope.projectId))!;
    assert.deepEqual(current.messages.map(message => message.role), ["checkly", "assistant"]);
    assert.equal(current.messages.some(message => message.result), false);
    assert.equal((await workspace.listScenarios(scope.projectId)).some(item => item.id === scenario.id), true);
    const file = JSON.parse(await readFile(path.join(dir, `ai-chat-${scope.projectId}.json`), "utf8"));
    assert.equal(Array.isArray(file), false);
    assert.equal(file.id, reset.id);
    assert.equal("messages" in file, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("reset opens a fresh Codex thread and following messages resume the new thread", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const turns: AiTurn[] = [];
    let thread = 0;
    const run = async (turn: AiTurn) => {
      turns.push(turn);
      if (!turn.resume) turn.onEvent?.({ type: "session", sessionId: `thread-${++thread}` });
      return "질문";
    };
    await workspace.saveAiChatSettings(scope.projectId, { ...(await workspace.getAiChatSettings(scope.projectId)), tool: "codex" });
    const chats = service(workspace, run, ["codex"]);
    const original = await chats.start({ scope });
    await chats.idle(scope.projectId, original.id);
    const reset = await chats.reset({ scope }, original.id);
    await chats.idle(scope.projectId, reset.id);
    await chats.send(scope.projectId, reset.id, "새 대화로 진행");
    await chats.idle(scope.projectId, reset.id);
    assert.deepEqual(turns.map(turn => [turn.sessionId, turn.resume]), [["", false], ["", false], ["thread-2", true]]);
    await assert.rejects(chats.send(scope.projectId, original.id, "예전 대화"), /대화를 찾을 수 없습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("simultaneous starts reserve the project before preparation and create only one chat", async () => {
  const { dir, workspace, scope } = await setup();
  const entered = deferred(), release = deferred();
  const prepare = workspace.aiChatSetup.bind(workspace);
  workspace.aiChatSetup = async request => { entered.resolve(); await release.promise; return prepare(request); };
  const ai = fakeAi(["질문"]);
  const chats = service(workspace, ai.run);
  let chatId: string | undefined;
  try {
    const starting = chats.start({ scope });
    await entered.promise;
    await assert.rejects(chats.start({ scope }), /대화를 처리하는 중/);
    await assert.rejects(chats.deleteProject(scope.projectId, id => workspace.deleteProject(id)), /프로젝트를 삭제할 수 없습니다/);
    assert.equal(await chats.get(scope.projectId), null);
    release.resolve();
    const chat = await starting;
    chatId = chat.id;
    await chats.idle(scope.projectId, chat.id);
    assert.equal((await chats.start({ scope })).id, chat.id);
    assert.equal(ai.turns.length, 1);
  } finally {
    release.resolve();
    if (chatId) await chats.idle(scope.projectId, chatId);
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed preparation and failed initial storage release the project so starting can be retried", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["질문"]);
    const chats = service(workspace, ai.run);
    const folders = (await workspace.getAiChatSettings(scope.projectId)).folders;
    await workspace.saveAiChatSettings(scope.projectId, { folders: {} });
    await assert.rejects(chats.start({ scope }), /백엔드 코드 폴더를 먼저 설정하세요/);
    assert.equal(await chats.get(scope.projectId), null);
    await workspace.saveAiChatSettings(scope.projectId, { folders });
    const write = workspace.writeAiChat.bind(workspace);
    workspace.writeAiChat = async () => { throw new Error("저장 실패"); };
    await assert.rejects(chats.start({ scope }), /저장 실패/);
    assert.equal(await chats.get(scope.projectId), null);
    assert.equal(ai.turns.length, 0);
    workspace.writeAiChat = write;
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("reset preparation or storage failures keep the previous chat and CLI session", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["질문", good, "계속 진행"]);
    const chats = service(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    await chats.send(scope.projectId, chat.id, "작성");
    await chats.idle(scope.projectId, chat.id);
    const previous = (await chats.get(scope.projectId))!;
    const file = path.join(dir, `ai-chat-${scope.projectId}.json`);
    const previousFile = await readFile(file, "utf8");
    const prepare = workspace.aiChatSetup.bind(workspace);
    workspace.aiChatSetup = async () => { throw new Error("준비 실패"); };
    await assert.rejects(chats.reset({ scope }, chat.id), /준비 실패/);
    assert.deepEqual(await chats.get(scope.projectId), previous);
    workspace.aiChatSetup = prepare;
    const write = workspace.writeAiChat.bind(workspace);
    workspace.writeAiChat = async () => { throw new Error("저장 실패"); };
    await assert.rejects(chats.reset({ scope }, chat.id), /저장 실패/);
    assert.deepEqual(await chats.get(scope.projectId), previous);
    assert.equal(await readFile(file, "utf8"), previousFile);
    workspace.writeAiChat = write;
    await chats.send(scope.projectId, chat.id, "이전 세션 계속");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns[2].resume, true);
    assert.equal(ai.turns[2].sessionId, ai.turns[0].sessionId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sending reserves the project before saving: duplicate messages, reset and deletion are blocked", async () => {
  const { dir, workspace, scope } = await setup();
  const chats = service(workspace, fakeAi(["질문", "답변"]).run);
  const chat = await chats.start({ scope });
  await chats.idle(scope.projectId, chat.id);
  const entered = deferred(), release = deferred();
  const write = workspace.writeAiChat.bind(workspace);
  let blocked = true;
  workspace.writeAiChat = async (projectId, value) => {
    if (blocked) { blocked = false; entered.resolve(); await release.promise; }
    return write(projectId, value);
  };
  try {
    const sending = chats.send(scope.projectId, chat.id, "한 번만 전송");
    await entered.promise;
    await assert.rejects(chats.send(scope.projectId, chat.id, "중복 전송"), /대화를 처리하는 중/);
    await assert.rejects(chats.reset({ scope }, chat.id), /대화를 처리하는 중/);
    await assert.rejects(chats.deleteProject(scope.projectId, id => workspace.deleteProject(id)), /프로젝트를 삭제할 수 없습니다/);
    assert.equal((await chats.get(scope.projectId))!.running?.phase, "answering");
    release.resolve();
    await sending;
    await chats.idle(scope.projectId, chat.id);
    assert.deepEqual((await chats.get(scope.projectId))!.messages.filter(message => message.role === "user").map(message => message.text), ["한 번만 전송"]);
  } finally { release.resolve(); await chats.idle(scope.projectId, chat.id); await rm(dir, { recursive: true, force: true }); }
});

test("failed message storage leaves the previous conversation unchanged and can be retried", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["질문", "답변"]);
    const chats = service(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    const previous = await chats.get(scope.projectId);
    const write = workspace.writeAiChat.bind(workspace);
    workspace.writeAiChat = async () => { throw new Error("저장 실패"); };
    await assert.rejects(chats.send(scope.projectId, chat.id, "실패한 메시지"), /저장 실패/);
    assert.deepEqual(await chats.get(scope.projectId), previous);
    assert.equal(ai.turns.length, 1);
    workspace.writeAiChat = write;
    await chats.send(scope.projectId, chat.id, "다시 전송");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns.length, 2);
    assert.deepEqual((await chats.get(scope.projectId))!.messages.filter(message => message.role === "user").map(message => message.text), ["다시 전송"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("idle and cancellation keep the project locked until the final write is on disk", async () => {
  const { dir, workspace, scope } = await setup();
  const started = deferred(), finalWrite = deferred(), release = deferred();
  const write = workspace.writeAiChat.bind(workspace);
  let blockNext = false;
  workspace.writeAiChat = async (projectId, value) => {
    if (blockNext) { blockNext = false; finalWrite.resolve(); await release.promise; }
    return write(projectId, value);
  };
  const chats = service(workspace, turn => new Promise((_resolve, reject) => {
    started.resolve();
    turn.signal!.addEventListener("abort", () => reject(new Error("AI 응답을 중단했습니다")), { once: true });
  }));
  const chat = await chats.start({ scope });
  try {
    await started.promise;
    blockNext = true;
    await chats.cancel(scope.projectId, chat.id);
    await finalWrite.promise;
    let finished = false;
    const idle = chats.idle(scope.projectId, chat.id).then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    await assert.rejects(chats.reset({ scope }, chat.id), /대화를 처리하는 중/);
    await assert.rejects(chats.send(scope.projectId, chat.id, "아직 저장 중"), /대화를 처리하는 중/);
    release.resolve();
    await idle;
    assert.match((await chats.get(scope.projectId))!.messages.at(-1)!.text, /중단/);
    // The session never started, so there is nothing to resume after a restart.
    assert.equal(await service(workspace, async () => "").get(scope.projectId), null);
    assert.equal((await chats.get(scope.projectId))!.running, undefined);
  } finally { release.resolve(); chats.cancelAll(); await chats.idle(scope.projectId, chat.id); await rm(dir, { recursive: true, force: true }); }
});

test("project deletion reserves the project and releases it on a failed deletion", async () => {
  const { dir, workspace, scope } = await setup();
  const entered = deferred(), release = deferred();
  try {
    const chats = service(workspace, async () => "질문");
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    const deleting = chats.deleteProject(scope.projectId, async () => { entered.resolve(); await release.promise; throw new Error("삭제 실패"); });
    await entered.promise;
    await assert.rejects(chats.start({ scope }), /대화를 처리하는 중/);
    await assert.rejects(chats.send(scope.projectId, chat.id, "삭제 중"), /대화를 처리하는 중/);
    await assert.rejects(chats.reset({ scope }, chat.id), /대화를 처리하는 중/);
    release.resolve();
    await assert.rejects(deleting, /삭제 실패/);
    assert.equal((await chats.start({ scope })).id, chat.id);
    await chats.deleteProject(scope.projectId, id => workspace.deleteProject(id));
    assert.equal(await chats.get(scope.projectId), null);
  } finally { release.resolve(); await rm(dir, { recursive: true, force: true }); }
});

test("a saved result marker is kept in memory; a restart keeps only the session", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const chats = service(workspace, fakeAi(["질문", good, good]).run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    await chats.send(scope.projectId, chat.id, "작성");
    await chats.idle(scope.projectId, chat.id);
    const result = (await chats.get(scope.projectId))!.messages.at(-1)!;
    assert.equal(result.saved, undefined);
    const savedScenario = await workspace.saveScenario(scope, result.result!.drafts[0].yaml, {});
    const scenarioId = savedScenario.id;
    await chats.markResultSaved(scope.projectId, chat.id, result.id, scenarioId);
    assert.deepEqual((await chats.get(scope.projectId))!.messages.at(-1)!.saved, { scenarioId });
    const restored = (await service(workspace, async () => "").get(scope.projectId))!;
    assert.equal(restored.messages.some(message => message.result), false);
    await chats.send(scope.projectId, chat.id, "추가 작성");
    await chats.idle(scope.projectId, chat.id);
    const next = (await chats.get(scope.projectId))!.messages.at(-1)!;
    await chats.markResultSaved(scope.projectId, chat.id, next.id);
    assert.deepEqual((await chats.get(scope.projectId))!.messages.at(-1)!.saved, {});
    await assert.rejects(chats.markResultSaved(scope.projectId, chat.id, chat.messages[0].id), /검사 결과를 찾을 수 없습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("every AI turn refreshes its chat environment and skips the CLI if refreshing fails", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["질문", broken, good]);
    const scopes: unknown[] = [];
    const refresh = workspace.refreshAiChatFiles.bind(workspace);
    workspace.refreshAiChatFiles = async input => { scopes.push(input); await refresh(input); };
    const chats = service(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    await chats.send(scope.projectId, chat.id, "작성");
    await chats.idle(scope.projectId, chat.id);
    // Setup also refreshes once; each CLI invocation refreshes again, including an automatic fix.
    assert.equal(scopes.length, ai.turns.length + 1);
    assert.ok(scopes.every(input => JSON.stringify(input) === JSON.stringify(scope)));
    workspace.refreshAiChatFiles = async () => { throw new Error("명세를 갱신하지 못했습니다"); };
    await chats.send(scope.projectId, chat.id, "최신 명세로 확인");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns.length, 3);
    const last = (await chats.get(scope.projectId))!.messages.at(-1)!;
    assert.equal(last.error, true);
    assert.match(last.text, /명세를 갱신하지 못했습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
