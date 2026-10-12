import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { splitAiBundle, yamlBlocks } from "../../src/app/api-testing/main/ai-context";
import { problemReport } from "../../src/app/api-testing/shared/ai-problem-report";

test("AI settings: several backend folders per server (absolute only) and the AI; kept out of the project and removed with it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-settings-"));
  const workspace = new ApiWorkspace(dir);
  const serverId = randomUUID(), adminId = randomUUID(), environmentId = randomUUID();
  const project = { id: randomUUID(), name: "AI", servers: [{ id: serverId, name: "상점" }, { id: adminId, name: "관리자" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://shop.example.com", [adminId]: "https://admin.example.com" } }] };
  try {
    await workspace.saveProject(project);
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

test("only YAML blocks are read as results: a folder tree or code sample next to them is not a scenario", () => {
  const good = "결과입니다.\n```yaml\nname: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n```\n";
  assert.deepEqual(yamlBlocks("계획\n```\nsrc/\n  UserController.java\n```\n```java\nclass A {}\n```"), []);
  assert.equal(yamlBlocks("```\nname: x\nsteps:\n  - api: GET /a\n```\n```yml\nsuite: {name: s, scenarios: [x]}\n```").length, 2);
  assert.deepEqual(splitAiBundle(`폴더\n\`\`\`\nsrc/\n\`\`\`\n${good}`).scenarios.length, 1);
});

test("a problem report asks for the whole result saved again to the same file", () => {
  const result = { drafts: [{ id: "a", name: "조회", yaml: "", stepCount: 1, issues: ["API를 찾을 수 없습니다"], notices: [], executionIssues: [] }], suite: null };
  assert.match(problemReport(result), /^Checkly 검사에서 아래 문제가 나왔습니다\. 문제를 고친 전체 결과\(모든 시나리오와 스위트\)를 같은 결과 파일에 다시 저장하세요/);
  assert.equal(problemReport({ ...result, drafts: [{ ...result.drafts[0], issues: [] }] }), "");
});
