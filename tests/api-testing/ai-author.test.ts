import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { availableAiClis, runAiCli, type AiCliRun } from "../../src/app/api-testing/main/ai-cli";
import { aiAnswerJsonSchema } from "../../src/app/api-testing/main/ai-context";

const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "상점", version: "1" }, paths: {
  "/login": { post: { tags: ["auth"], summary: "로그인", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["loginId"], properties: { loginId: { type: "string", example: "example-secret" } } } } } }, responses: { "200": { description: "성공", content: { "application/json": { schema: { type: "object", properties: { accessToken: { type: "string" }, id: { type: "integer" } } } } } } } } },
  "/items/{id}": { get: { tags: ["item"], summary: "상품 조회", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "성공" } } } },
} });

const login = "id: shop/login\nname: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n    auth: none\n    body: { loginId: tester }\n    extract: [{ source: body, pointer: /accessToken, target: globals.accessToken, sensitive: true }]\n";
const read = "id: shop/read\nname: 상품 조회\nserver: 상점\nsteps:\n  - name: 상품 조회\n    api: GET /items/{id}\n    auth: globals.accessToken\n    pathParams: { id: 7 }\n";

async function setup(backendPath?: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-author-"));
  const workspace = new ApiWorkspace(dir);
  const serverId = randomUUID(), environmentId = randomUUID();
  const project = { id: randomUUID(), name: "AI", servers: [{ id: serverId, name: "상점" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://private-base.example.com" } }], ...(backendPath ? { backendPath } : {}) };
  await workspace.saveProject(project);
  await workspace.importSpec({ projectId: project.id, serverId, environmentId }, spec);
  await workspace.setGlobal({ projectId: project.id }, "accessToken", "global-secret-value");
  return { dir, workspace, project, scope: { projectId: project.id, environmentId } };
}

test("authoring checks each YAML, asks the AI to repair problems and returns reviewable drafts", async () => {
  const { dir, workspace, project, scope } = await setup();
  try {
    await workspace.saveScenario(scope, "id: taken\nname: 기존\nserver: 상점\nsteps:\n  - { api: 'GET /items/{id}', pathParams: { id: 1 } }\n", {});
    const runs: AiCliRun[] = [];
    let catalog = "";
    const answers = [
      { scenarios: [{ yaml: login }, { yaml: read.replace("GET /items/{id}", "GET /missing") }, { yaml: read.replace("shop/read", "taken") }], suite: { name: "상점 흐름", scenarioIds: ["shop/login", "shop/read"] }, notes: "첫 시도" },
      { scenarios: [{ yaml: login }, { yaml: read }], suite: { name: "상점 흐름", scenarioIds: ["shop/login", "shop/read"] }, notes: "수정함" },
    ];
    const result = await workspace.authorWithAi({ scope, cli: "claude", goal: "로그인 후 상품 조회", includeSuite: true }, {
      run: async run => { runs.push(run); catalog = await readFile(path.join(run.readDirs[0], "checkly-api-catalog.json"), "utf8"); return answers[runs.length - 1]; },
    });

    assert.equal(runs.length, 2);
    assert.equal(result.attempts, 2);
    assert.deepEqual(result.drafts.map(draft => [draft.id, draft.issues]), [["shop/login", []], ["shop/read", []]]);
    assert.deepEqual(result.suite, { name: "상점 흐름", scenarioIds: ["shop/login", "shop/read"], problems: [] });
    assert.equal(result.notes, "수정함");
    // The first attempt's problems are fed back.
    assert.match(runs[1].prompt, /API를 유일하게 찾을 수 없습니다/);
    assert.match(runs[1].prompt, /id 'taken'가 기존 시나리오와 겹칩니다/);
    // Prompt: index, rules, existing ids, global names; no values, base URL or examples.
    const prompt = runs[0].prompt;
    assert.ok(prompt.includes("POST /login — 로그인 [auth]") && prompt.includes('"taken"') && prompt.includes('"accessToken"'));
    for (const secret of ["global-secret-value", "private-base.example.com", "example-secret"]) {
      assert.equal(prompt.includes(secret), false, secret);
      assert.equal(catalog.includes(secret), false, secret);
    }
    assert.ok(catalog.includes('"loginId"'));
    assert.deepEqual(runs[0].schema, aiAnswerJsonSchema);
    assert.equal(runs[0].cwd, runs[0].readDirs[0]);
    assert.equal(workspace.getAiProgress({ projectId: project.id }), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("remaining problems after the last attempt stay on the drafts and suite", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    let calls = 0;
    const result = await workspace.authorWithAi({ scope, cli: "codex", goal: "조회", includeSuite: true }, {
      maxAttempts: 2,
      run: async () => { calls++; return { scenarios: [{ yaml: "name: [" }, { yaml: read }], suite: { name: "", scenarioIds: ["shop/read", "ghost"] }, notes: "" }; },
    });
    assert.equal(calls, 2);
    assert.match(result.drafts[0].issues[0], /^YAML 오류/);
    assert.deepEqual(result.drafts[1].issues, []);
    assert.deepEqual(result.suite, { name: "AI 스위트", scenarioIds: ["shop/read", "ghost"], problems: ["스위트의 'ghost'가 생성한 시나리오 id에 없습니다"] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tags narrow the APIs, the backend folder becomes the working directory, and runs can be cancelled", async () => {
  const backend = await mkdtemp(path.join(tmpdir(), "checkly-backend-"));
  const { dir, workspace, project, scope } = await setup(backend);
  try {
    let seen: AiCliRun | undefined;
    const pending = workspace.authorWithAi({ scope, cli: "claude", goal: "상품", includeSuite: false, tags: ["item"] }, {
      run: run => { seen = run; return new Promise((_, reject) => run.signal!.addEventListener("abort", () => reject(new Error("AI 작성을 취소했습니다")))); },
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(seen!.cwd, backend);
    assert.ok(seen!.prompt.includes("GET /items/{id}") && !seen!.prompt.includes("POST /login"));
    assert.ok(seen!.prompt.includes("백엔드 소스입니다"));
    assert.deepEqual(workspace.getAiProgress({ projectId: project.id }), { phase: "writing", attempt: 1, maxAttempts: 3 });
    await assert.rejects(workspace.authorWithAi({ scope, cli: "claude", goal: "중복", includeSuite: false }, { run: async () => ({}) }), /이미 AI 작성/);
    workspace.cancelAiAuthor({ projectId: project.id });
    await assert.rejects(pending, /취소/);
    await workspace.saveProject({ ...project, backendPath: path.join(backend, "missing") });
    await assert.rejects(workspace.authorWithAi({ scope, cli: "claude", goal: "상품", includeSuite: false }, { run: async () => ({}) }), /백엔드 폴더를 찾을 수 없습니다/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(backend, { recursive: true, force: true });
  }
});

test("CLI runner passes read-only flags and reads both CLIs' answer formats", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-fake-cli-"));
  const previous = process.env.CHECKLY_AI_CLI_PATH;
  try {
    const fake = path.join(dir, "fake-cli.mjs");
    await writeFile(fake, `#!/usr/bin/env node
import { writeFileSync, appendFileSync } from "node:fs";
const args = process.argv.slice(2);
let input = ""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => {
  appendFileSync(${JSON.stringify(path.join(dir, "calls.jsonl"))}, JSON.stringify({ args, cwd: process.cwd(), input }) + "\\n");
  if (input === "fail") { process.stdout.write(JSON.stringify({ type: "result", is_error: true, result: "Not logged in · Please run /login" })); process.exit(1); }
  const answer = { scenarios: [{ yaml: "name: x" }], suite: null, notes: "ok" };
  if (args[0] === "exec") writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify(answer));
  else process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: answer }));
});
`);
    await chmod(fake, 0o755);
    process.env.CHECKLY_AI_CLI_PATH = fake;
    assert.deepEqual(await availableAiClis(), ["claude", "codex"]);
    const base = { prompt: "작성해줘", cwd: dir, readDirs: [dir], schema: aiAnswerJsonSchema };
    assert.deepEqual(await runAiCli({ ...base, cli: "claude" }), { scenarios: [{ yaml: "name: x" }], suite: null, notes: "ok" });
    assert.deepEqual(await runAiCli({ ...base, cli: "codex" }), { scenarios: [{ yaml: "name: x" }], suite: null, notes: "ok" });
    const [claude, codex] = (await readFile(path.join(dir, "calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(claude.input, "작성해줘");
    assert.ok(claude.args.includes("--json-schema") && claude.args.includes("--add-dir"));
    assert.deepEqual(claude.args.slice(claude.args.indexOf("--allowedTools") + 1, claude.args.indexOf("--allowedTools") + 4), ["Read", "Grep", "Glob"]);
    assert.ok(claude.args.includes("Bash") && claude.args.includes("Write"));
    assert.equal(codex.args[codex.args.indexOf("--sandbox") + 1], "read-only");
    assert.equal(codex.input, "작성해줘");
    // Claude reports failures as a JSON result on stdout with exit code 1.
    await assert.rejects(runAiCli({ ...base, prompt: "fail", cli: "claude" }), /종료 코드 1\)\. Not logged in/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runAiCli({ ...base, cli: "claude", signal: controller.signal }), /취소/);
  } finally {
    if (previous === undefined) delete process.env.CHECKLY_AI_CLI_PATH; else process.env.CHECKLY_AI_CLI_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
