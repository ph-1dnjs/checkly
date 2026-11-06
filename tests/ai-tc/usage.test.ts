import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { callModel, readUsage } from "../../src/app/ipc/ai-tc/ai";

test("Codex 완료 이벤트에서 사용량을 읽는다", () => {
  const output = '{"type":"item.completed"}\n{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":60,"output_tokens":12}}';
  assert.deepEqual(readUsage("codex", output), { input: 100, cachedInput: 60, output: 12 });
});

test("CLI가 답과 사용량을 출력해도 비정상 종료하면 성공으로 처리하지 않는다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-cli-test-"));
  const file = path.join(dir, "fake-cli");
  try {
    await writeFile(file, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{"result":"답변","usage":{"input_tokens":3,"output_tokens":2}}'\nexit 1\n`);
    await chmod(file, 0o755);
    let received: unknown;
    const call = callModel({ tool: "claude", file, cwd: dir, prompt: "test", onUsage: usage => { received = usage; } });
    await assert.rejects(call.promise, /종료 코드 1/);
    assert.deepEqual(received, { input: 3, output: 2 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Claude 캐시 사용량과 누락된 사용량을 구분한다", () => {
  assert.deepEqual(readUsage("claude", '{"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":30,"cache_creation_input_tokens":20}}'), { input: 10, output: 5, cachedInput: 30, cacheWrite: 20 });
  assert.equal(readUsage("codex", '{"type":"turn.failed"}'), undefined);
  assert.equal(readUsage("claude", '{"usage":{"input_tokens":10}}'), undefined);
});
