import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { exportRunWorkbook } from "../../src/app/ipc/ai-tc/export";
import type { AiTcRunState } from "../../src/app/ipc/ai-tc/model";

test("결과 요약과 실패한 기대 결과의 근거를 구분해 내보낸다", async () => {
  const state: AiTcRunState = {
    runId: "run-1", status: "done", current: 1, url: "", outOfDomain: false, capturePaused: false,
    provider: "codex", allowedHosts: ["example.com"], viewport: { width: 1280, height: 720 }, capture: true, video: false,
    startedAt: "2026-11-03T00:00:00Z", endedAt: "2026-11-03T00:01:00Z",
    budget: { actions: 2, modelCalls: 2, maxActions: 40, maxModelCalls: 300, maxMinutes: 10 },
    usage: { input: 100, output: 20, cachedInput: 40, cacheWrite: 0, measured: 1, unknown: 1 },
    preparationUsage: { claude: { input: 0, output: 0, cached: 0, write: 0, unknown: 0 }, codex: { input: 30, output: 4, cached: 10, write: 0, unknown: 0 } },
    cases: [
      { key: "a", id: "TC-1", scenarioId: "SC-1", pre: "로그인", steps: ["등록 클릭", "결과 확인"], title: "등록", sheet: "TC", row: 4, reason: "등록 실패", timing: { modelMs: 123, observationMs: 45, browserMs: 67 }, usage: { input: 100, output: 20, cachedInput: 40, cacheWrite: 0, measured: 1, unknown: 1 }, expected: [
        { id: "E1", text: "등록 완료", verdict: "fail", observation: "오류 표시", basis: [{ k: "화면", v: "실패" }], captureId: "cap-01", by: "ai" },
        { id: "E2", text: "목록 표시", verdict: "pass", observation: "목록", basis: [], by: "ai" },
      ], actions: [{ seq: 1, at: "10:00", expected: "E1", op: "클릭", target: "등록", result: "대상 없음", tone: "fail" }] },
      { key: "b", id: "TC-2", title: "조회", sheet: "TC", row: 5, expected: [{ id: "E1", text: "조회", verdict: "blocked", observation: "로그인 필요", basis: [], by: "system" }], actions: [] },
    ],
  };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportRunWorkbook(state, "운영") as unknown as ArrayBuffer);
  const summary = workbook.getWorksheet("요약")!;
  assert.equal(summary.getCell("B9").value, 2);
  assert.equal(summary.getCell("B11").value, 1);
  assert.equal(summary.getCell("B12").value, 1);
  const summaryRows = new Map(summary.getRows(2, summary.rowCount - 1)!.map(row => [row.getCell(1).value, row.getCell(2).value]));
  assert.equal(summaryRows.get("실행 입력 토큰"), 100);
  assert.equal(summaryRows.get("실행 사용량 미확인 호출"), 1);
  assert.equal(summaryRows.get("준비 codex 입력"), 30);
  assert.equal(workbook.getWorksheet("TC 결과")!.getCell("I2").value, 123);
  assert.equal(workbook.getWorksheet("TC 결과")!.getCell("L2").value, 100);
  const failures = workbook.getWorksheet("실패 상세")!;
  assert.equal(failures.rowCount, 2);
  assert.equal(failures.getCell("A2").value, "TC-1");
  assert.equal(failures.getCell("G2").value, "등록 완료");
  assert.equal(failures.getCell("H2").value, "오류 표시");
  assert.equal(failures.getCell("I2").value, "화면: 실패");
  assert.match(String(failures.getCell("J2").value), /대상 없음/);
  assert.equal(failures.getCell("K2").value, "cap-01.jpg");
  assert.equal(failures.getCell("O2").value, "SC-1");
  assert.equal(failures.getCell("P2").value, "로그인");
  assert.equal(failures.getCell("Q2").value, "등록 클릭\n결과 확인");
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.getRow(1).font.bold, true);
    assert.ok(sheet.autoFilter);
    assert.equal(sheet.views[0]?.state, "frozen");
  }
});
