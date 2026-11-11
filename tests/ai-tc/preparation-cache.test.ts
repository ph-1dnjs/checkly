import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PreparationCache } from "../../src/app/ipc/ai-tc/preparation-cache";

test("세팅과 업로드 파일을 다시 열고 TC 내용 변경은 캐시 미스로 처리한다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-preparation-"));
  try {
    const source = path.join(dir, "source.txt");
    await writeFile(source, "파일 내용");
    const item = { key: "qa.xlsx:TC:2", id: "TC1", scenarioId: "", pre: "", steps: ["입력"], expected: [{ id: "E1", text: "확인" }], given: "", scenario: "" };
    const uploads = new Map([["original", source]]);
    const cache = new PreparationCache(path.join(dir, "cache"), uploads);
    await cache.save(item, { key: item.key, data: [{ label: "값", value: "수정한 값" }], files: [{ label: "첨부", token: "original", name: "source.txt", spec: "직접 고른 파일" }], note: "메모" });
    const restoredUploads = new Map<string, string>();
    const restored = await new PreparationCache(path.join(dir, "cache"), restoredUploads).load(item);
    assert.equal(restored?.data[0]?.value, "수정한 값");
    assert.ok(restoredUploads.has(restored!.files[0]!.token));
    assert.equal(await cache.load({ ...item, steps: ["다른 단계"] }), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
