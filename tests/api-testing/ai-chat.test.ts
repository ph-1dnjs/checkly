import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { AiChatService, maxAutoFixes } from "../../src/app/api-testing/main/ai-chat";
import { claudeArgs, runClaudeTurn, type AiTurn } from "../../src/app/api-testing/main/ai-cli";
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
  return { dir, workspace, project, serverId, adminId, scope: { projectId: project.id, environmentId } };
}

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

test("backend folders: several per server, absolute only, kept out of the project and removed with it", async () => {
  const { dir, workspace, project, serverId, adminId } = await setup();
  try {
    const member = path.join(dir, "member-api"), common = path.join(dir, "common-lib");
    const saved = await workspace.saveBackendFolders(project.id, { [serverId]: [member, common, member], [adminId]: [], [randomUUID()]: [common] });
    assert.deepEqual(saved, { [serverId]: [member, common] });
    assert.deepEqual(await new ApiWorkspace(dir).getBackendFolders(project.id), saved);
    await assert.rejects(workspace.saveBackendFolders(project.id, { [serverId]: ["relative/path"] }), /절대 경로/);
    assert.equal(JSON.stringify(await workspace.listProjects()).includes("member-api"), false);
    await workspace.deleteProject(project.id);
    assert.equal((await readFile(path.join(dir, "backend-folders.json"), "utf8")).includes(project.id), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("chat setup runs in the first backend folder, reads the rest and the API file, and plans before writing", async () => {
  const { dir, workspace, project, serverId, adminId, scope } = await setup();
  try {
    const member = path.join(dir, "member-api"), common = path.join(dir, "common-lib"), admin = path.join(dir, "admin-api");
    for (const folder of [member, common, admin]) await mkdir(folder);
    await workspace.saveBackendFolders(project.id, { [serverId]: [member, common], [adminId]: [admin] });
    const setup = await workspace.aiChatSetup({ scope });
    const aiDir = path.join(dir, "ai", project.id);
    assert.equal(setup.cwd, member);
    assert.deepEqual(setup.readDirs, [common, admin, aiDir]);
    assert.equal(setup.folderCount, 3);
    assert.ok(setup.prompt.includes(`- 상점: ${member}, ${common}`) && setup.prompt.includes(`- 관리자: ${admin}`));
    assert.ok(setup.prompt.includes("계획을 제안하고 사용자의 확인을 기다리세요") && setup.prompt.includes("yaml 코드 블록 하나로 출력"));
    assert.equal(setup.prompt.includes("AI 결과 불러오기"), false);
    assert.equal(setup.prompt.includes("scenarios.yaml"), false);
    // Without folders Claude runs in the API file folder.
    await workspace.saveBackendFolders(project.id, {});
    assert.deepEqual(await workspace.aiChatSetup({ scope }).then(({ cwd, readDirs }) => ({ cwd, readDirs })), { cwd: aiDir, readDirs: [] });
    await workspace.saveBackendFolders(project.id, { [serverId]: [path.join(dir, "gone")] });
    await assert.rejects(workspace.aiChatSetup({ scope }), /백엔드 폴더를 찾을 수 없습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a chat keeps one Claude session: the guide opens it, later turns resume it", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["무엇을 테스트할까요?", "시나리오 2개로 나눌게요. 괜찮을까요?"]);
    const chats = new AiChatService(workspace, ai.run);
    const chat = await chats.start({ scope, model: "sonnet" });
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns[0].resume, false);
    assert.equal(ai.turns[0].model, "sonnet");
    assert.ok(ai.turns[0].prompt.includes("# Checkly API 시나리오 작성 가이드") && ai.turns[0].prompt.includes("먼저 질문하세요"));
    await chats.send(scope.projectId, chat.id, "로그인 후 상품 조회");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns[1].resume, true);
    assert.equal(ai.turns[1].sessionId, ai.turns[0].sessionId);
    assert.equal(ai.turns[1].prompt, "로그인 후 상품 조회");
    // The guide points at the saved-state file, rewritten before every turn instead of resending the guide.
    const stateFile = path.join(dir, "ai", scope.projectId, "project-state.json");
    assert.ok(ai.turns[0].prompt.includes(stateFile) && ai.turns[0].prompt.includes("메시지를 보낼 때마다 이 파일을 최신으로 갱신"));
    await workspace.saveScenario(scope, "name: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n", {});
    await chats.send(scope.projectId, chat.id, "방금 저장한 것도 봐 주세요");
    await chats.idle(scope.projectId, chat.id);
    assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")).scenarios.map((item: { name: string }) => item.name), ["로그인"]);
    assert.equal(ai.turns[2].prompt, "방금 저장한 것도 봐 주세요");
    const saved = await new AiChatService(workspace, ai.run).get(scope.projectId, chat.id);
    assert.deepEqual(saved?.messages.map(message => message.role), ["checkly", "assistant", "user", "assistant", "user", "assistant"]);
    assert.equal(saved?.title, "로그인 후 상품 조회");
    assert.deepEqual(saved?.messages[1].tools, ["Read UserController.java"]);
    assert.equal(JSON.stringify(saved).includes(ai.turns[0].sessionId), false);
    assert.deepEqual((await chats.list(scope.projectId)).map(item => item.id), [chat.id]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("YAML answers are checked; problems go back to the AI on their own until fixed", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["질문", broken, good]);
    const chats = new AiChatService(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    await chats.send(scope.projectId, chat.id, "좋아요, 작성해 주세요");
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns.length, 3);
    assert.match(ai.turns[2].prompt, /Checkly 검사에서 아래 문제가 나왔습니다[\s\S]*yaml 코드 블록 하나로 다시 출력/);
    const messages = (await chats.get(scope.projectId, chat.id))!.messages;
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
    const chats = new AiChatService(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    let messages = (await chats.get(scope.projectId, chat.id))!.messages;
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
    messages = (await chats.get(scope.projectId, chat.id))!.messages;
    assert.match(messages.at(-1)!.text, new RegExp(`자동 수정 ${maxAutoFixes}번 뒤에도 문제가 남았습니다`));
    assert.ok(messages.at(-1)!.result?.drafts[0].issues.length);
    await assert.rejects(chats.send(scope.projectId, chat.id, " "), /메시지를 입력하세요/);
    await chats.remove(scope.projectId, chat.id);
    assert.deepEqual(await chats.list(scope.projectId), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Claude runs read-only and isolated, streams text and tool calls, and explains login failures", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-fake-claude-"));
  const previous = process.env.CHECKLY_AI_CLI_PATH;
  try {
    const args = claudeArgs({ sessionId: "s1", resume: true, readDirs: ["/a", "/b"], model: "opus" });
    assert.deepEqual(args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 2), ["--resume", "s1"]);
    for (const flag of ["--restricted", "--strict-mcp-config", "--include-partial-messages"]) assert.ok(args.includes(flag), flag);
    assert.deepEqual(args.slice(args.indexOf("--tools") + 1, args.indexOf("--tools") + 4), ["Read", "Grep", "Glob"]);
    assert.ok(args.join(" ").includes("--add-dir /a --add-dir /b") && args.join(" ").includes("--model opus"));
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
    const answer = await runClaudeTurn({ sessionId: "s1", resume: false, prompt: "hi", cwd: dir, readDirs: [], onEvent: event => events.push(event) });
    assert.ok(answer.startsWith("안녕하세요") && answer.includes(path.basename(dir)));
    assert.deepEqual(events, [{ type: "text", text: "안녕" }, { type: "tool", detail: "Read /a/User.java" }]);
    await assert.rejects(runClaudeTurn({ sessionId: "s1", resume: false, prompt: "fail", cwd: dir, readDirs: [] }), /Not logged in[\s\S]*해결: 터미널에서 claude를 실행한 뒤 \/login/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runClaudeTurn({ sessionId: "s1", resume: false, prompt: "hi", cwd: dir, readDirs: [], signal: controller.signal }), /중단/);
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
    assert.equal(await runClaudeTurn({ sessionId: "s1", resume: false, prompt: "hi", cwd: dir, readDirs: [] }), "한글 답변");
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
    const chats = new AiChatService(workspace, ai.run);
    const chat = await chats.start({ scope });
    await chats.idle(scope.projectId, chat.id);
    assert.equal(ai.turns.length, 1);
    assert.deepEqual((await chats.get(scope.projectId, chat.id))!.messages.map(message => message.role), ["checkly", "assistant"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("stopping while Checkly checks says it was stopped, not that fixes ran out", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const ai = fakeAi(["질문", broken]);
    let chatId = "";
    // The user presses stop right after the YAML answer arrives, while Checkly checks it.
    const chats: AiChatService = new AiChatService(workspace, async turn => { const answer = await ai.run(turn); if (answer === broken) void chats.cancel(scope.projectId, chatId); return answer; });
    const chat = await chats.start({ scope });
    chatId = chat.id;
    await chats.idle(scope.projectId, chat.id);
    await chats.send(scope.projectId, chat.id, "작성해 주세요");
    await chats.idle(scope.projectId, chat.id);
    const last = (await chats.get(scope.projectId, chat.id))!.messages.at(-1)!;
    assert.equal(ai.turns.length, 2);
    assert.match(last.text, /중단했습니다/);
    assert.ok(last.result?.drafts[0].issues.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a project cannot be deleted while its chat answers; after deletion its chats are gone; quitting stops every chat", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const chats = new AiChatService(workspace, turn => new Promise((_resolve, reject) => {
      turn.signal?.addEventListener("abort", () => reject(new Error("AI 응답을 중단했습니다")), { once: true });
    }));
    const chat = await chats.start({ scope });
    const remove = (projectId: string) => workspace.deleteProject(projectId);
    await assert.rejects(chats.deleteProject(scope.projectId, remove), /AI가 답하는 중에는 프로젝트를 삭제할 수 없습니다/);
    assert.equal((await workspace.listProjects()).length, 1);
    await chats.cancel(scope.projectId, chat.id);
    await chats.idle(scope.projectId, chat.id);
    await chats.deleteProject(scope.projectId, remove);
    await assert.rejects(readFile(path.join(dir, `ai-chats-${scope.projectId}.json`), "utf8"), { code: "ENOENT" });
    assert.deepEqual(await chats.list(scope.projectId), []);

    const other = await setup();
    try {
      const quitting = new AiChatService(other.workspace, turn => new Promise((_resolve, reject) => turn.signal?.addEventListener("abort", () => reject(new Error("AI 응답을 중단했습니다")), { once: true })));
      const running = await quitting.start({ scope: other.scope });
      quitting.cancelAll();
      await quitting.idle(other.scope.projectId, running.id);
      assert.match((await quitting.get(other.scope.projectId, running.id))!.messages.at(-1)!.text, /중단/);
    } finally { await rm(other.dir, { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
