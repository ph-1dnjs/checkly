import { test } from "node:test";
import assert from "node:assert/strict";
import { specRefreshStatus, isProductionEnvironment, specRefreshNeedsSettings } from "../../src/renderer/features/api-testing/configure-spec/model/spec-refresh-status";

const now = Date.parse("2026-10-26T03:00:00Z");
const catalog = { importedAt: "2026-10-26T02:50:00Z" };
const sync = { url: "https://example.com/openapi.json", hasSavedAccount: false, secureStorageAvailable: false };

test("loaded specs show import age without promising the source is up to date", () => {
  assert.deepEqual(specRefreshStatus(catalog, sync, false, false, "", now), { tone: "idle", text: "10분 전 동기화", detail: "" });
  assert.equal(specRefreshStatus(catalog, null, false, false, "", now).detail, "파일 문서");
  assert.equal(specRefreshStatus({ importedAt: "invalid" }, sync, false, false, "", now).text, "동기화 시각 없음");
  assert.equal(specRefreshStatus({ importedAt: "2026-10-26T04:00:00Z" }, sync, false, false, "", now).text, "방금 동기화");
});

test("refreshing, missing and failed states describe whether the previous spec is retained", () => {
  assert.equal(specRefreshStatus(catalog, sync, true, true, "old error", now).text, "갱신 중…");
  assert.equal(specRefreshStatus(catalog, sync, true, false, "", now).text, "문서 읽는 중…");
  assert.deepEqual(specRefreshStatus(null, sync, false, false, "", now), { tone: "warn", text: "등록 필요", detail: "" });
  assert.deepEqual(specRefreshStatus(catalog, { ...sync, status: "failed" }, false, false, "", now), { tone: "warn", text: "갱신 실패", detail: "이전 문서 사용 중" });
  assert.equal(specRefreshStatus(null, sync, false, false, "offline", now).detail, "등록 필요");
});

test("production emphasis is restricted to recognizable production environment names", () => {
  for (const name of ["운영", "prod", "Production", " PROD "]) assert.equal(isProductionEnvironment(name), true);
  for (const name of ["local", "dev", "stage", "product-test"]) assert.equal(isProductionEnvironment(name), false);
});


test("refresh opens settings for missing sources or credentials, including a deleted remembered account", () => {
  assert.equal(specRefreshNeedsSettings(null, "none"), true);
  assert.equal(specRefreshNeedsSettings({ ...sync, url: undefined }, "none"), true);
  assert.equal(specRefreshNeedsSettings(sync, "none"), false);
  assert.equal(specRefreshNeedsSettings({ ...sync, username: "user" }, "none"), true);
  assert.equal(specRefreshNeedsSettings(sync, "basic"), true);
  assert.equal(specRefreshNeedsSettings({ ...sync, hasSavedAccount: true, username: "user" }, "basic"), false);
});
