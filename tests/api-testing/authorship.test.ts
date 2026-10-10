import { test } from "node:test";
import assert from "node:assert/strict";
import { authorshipParts, lastEditedText, relativeTime } from "../../src/renderer/entities/api-testing/lib/authorship";

const now = new Date(2026, 9, 9, 14, 30);
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

test("relative time reads like the rest of the app", () => {
  assert.deepEqual([0.2, 3, 125, 60 * 30, 60 * 24 * 4, 60 * 24 * 10].map(minutes => relativeTime(at(minutes), now)), ["방금", "3분 전", "2시간 전", "어제", "4일 전", "09/29"]);
});

test("list rows show the last editor only in team mode; the header says who made and changed it", () => {
  const created = at(10), updated = at(3);
  assert.equal(lastEditedText({ updatedAt: updated, updatedBy: "hyewon" }, now), "hyewon · 3분 전");
  assert.equal(lastEditedText({ updatedAt: updated }, now), "");
  assert.deepEqual(authorshipParts({ createdAt: created, createdBy: "minsu", updatedAt: updated, updatedBy: "hyewon" }, now), ["minsu 작성 · 10/09 14:20", "hyewon 수정 · 3분 전"]);
  // Never changed since: only who made it.
  assert.deepEqual(authorshipParts({ createdAt: created, createdBy: "minsu", updatedAt: created, updatedBy: "minsu" }, now), ["minsu 작성 · 10/09 14:20"]);
  // A member who left reads "(나간 멤버)" like any other name.
  assert.deepEqual(authorshipParts({ createdAt: created, createdBy: "(나간 멤버)", updatedAt: updated, updatedBy: "hyewon" }, now), ["(나간 멤버) 작성 · 10/09 14:20", "hyewon 수정 · 3분 전"]);
  // File mode: no names, so nothing.
  assert.deepEqual(authorshipParts({ updatedAt: updated }, now), []);
});
