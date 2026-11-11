import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareBatches } from "../../src/renderer/app/hooks/prepareBatches";

test("묶음 누락과 실패를 분리해 성공 결과를 보존한다", async () => {
  const items = ["a", "b", "c", "d"].map(key => ({ key }));
  const calls: string[] = [], reasons: string[] = [], successes: string[] = [], failures: string[] = [];
  await prepareBatches(items, async (group, reason) => {
    const keys = group.map(item => item.key).join("");
    calls.push(keys);
    reasons.push(reason);
    if (keys === "abcd") return [{ key: "a" }, { key: "b" }];
    if (keys === "d") throw new Error("실패");
    return group;
  }, item => successes.push(item.key), item => failures.push(item.key), () => true);
  assert.deepEqual(calls, ["abcd", "c", "d"]);
  assert.deepEqual(reasons, ["initial", "missing", "missing"]);
  assert.deepEqual(successes, ["a", "b", "c"]);
  assert.deepEqual(failures, ["d"]);
});

test("묶음 호출 오류는 실패 사유로 나눠 재시도한다", async () => {
  const reasons: string[] = [];
  await prepareBatches([{ key: "a" }, { key: "b" }], async (group, reason) => {
    reasons.push(reason);
    if (group.length > 1) throw new Error("실패");
    return group;
  }, () => {}, () => assert.fail("개별 요청은 성공해야 한다"), () => true);
  assert.deepEqual(reasons, ["initial", "failure", "failure"]);
});
