import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { AiTcImportError, readWorkbook } from "../../src/app/ipc/ai-tc/excel";
import { buildCases } from "../../src/app/ipc/ai-tc/model";

async function sample(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("BOS_시나리오").addRow(["시나리오 ID", "시나리오명"]);
  const sheet = workbook.addWorksheet("BOS_TC");
  sheet.addRow(["QA_프로모션 카테고리"]);
  sheet.addRow([]);
  sheet.addRow(["시나리오 ID", "TC ID", "구분", "사전 조건", "테스트 단계", "기대 결과", "테스트 데이터", "Chrome 결과", "담당자"]);
  sheet.addRow(["SC-01", "SC-01-TC01", "목록", "BOS 관리자 로그인", "카테고리 관리 메뉴 클릭", "1. 목록 표시\n2. [신규 등록] 노출", "", "Pass", "홍길동"]);
  sheet.addRow(["", "SC-01-TC02", "등록", "SC-01-TC01을 완료합니다.", "[신규 등록] 클릭", { richText: [{ text: "등록 화면이 " }, { text: "열린다" }] }, "", "", ""]);
  sheet.addRow(["", "SC-01-TC03", "유효성", "", "카테고리명 입력", { formula: "A1" }, "", "", ""]);
  sheet.mergeCells("A4:A6");
  const hidden = sheet.addRow(["", "SC-01-TC09", "숨김", "", "숨긴 단계", "숨긴 결과"]);
  hidden.hidden = true;
  workbook.addWorksheet("결과요약").addRow(["합계", 3]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("TC 시트의 머리글·병합·리치 텍스트·수식·숨김 행을 읽는다", async () => {
  const workbook = await readWorkbook("QA_프로모션.xlsx", await sample());
  assert.deepEqual(workbook.sheets.map(sheet => [sheet.name, sheet.headerRow]), [["BOS_시나리오", 0], ["BOS_TC", 3], ["결과요약", 0]]);
  const cases = buildCases(workbook, { hiddenSheets: false, hiddenRows: false });
  assert.deepEqual(cases.map(item => item.id), ["SC-01-TC01", "SC-01-TC02", "SC-01-TC03"]);
  assert.equal(cases[1]!.scenarioId, "SC-01", "병합된 시나리오 ID는 이어받는다");
  assert.equal(cases[1]!.expected[0]!.text, "등록 화면이 열린다");
  assert.deepEqual(cases[0]!.expected.map(item => item.text), ["목록 표시", "[신규 등록] 노출"]);
  assert.deepEqual(cases[2]!.errors, ["기대 결과 없음"]);
  assert.deepEqual(cases[2]!.warnings, ["값이 없는 수식 칸"]);
  assert.equal(buildCases(workbook, { hiddenSheets: false, hiddenRows: true }).length, 4);
});

test(".xlsx가 아니거나 손상된 파일은 가져오지 않는다", async () => {
  await assert.rejects(readWorkbook("a.xls", Buffer.from("x")), AiTcImportError);
  await assert.rejects(readWorkbook("a.xlsx", Buffer.from("not a zip")), /손상/);
});

test("표 위 공통 사전 조건은 실행에 전달하고 TC명은 이름 열로 표시한다", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("BOS_TC");
  sheet.addRow(["공통 사전 조건", "BOS 로그인 후 프로모션 관리 진입"]);
  sheet.mergeCells("B1:H1");
  sheet.addRow(["공통 사전 조건", "숨긴 조건"]);
  sheet.getRow(2).hidden = true;
  sheet.addRow(["테스트케이스 ID", "테스트케이스명", "테스트 절차", "사전조건", "예상결과"]);
  sheet.addRow(["A-001", "제목 공란 검증", "제목을 지운다", "정상 초안", "오류 표시"]);
  sheet.addRow(["A-002", "", "등록 일시 정렬 클릭", "", "정렬됨"]);
  const other = book.addWorksheet("다른 TC");
  other.addRow(["TC ID", "테스트 단계", "기대 결과"]);
  other.addRow(["B-001", "조회", "표시"]);
  const workbook = await readWorkbook("common.xlsx", Buffer.from(await book.xlsx.writeBuffer()));
  const cases = buildCases(workbook, { hiddenSheets: false, hiddenRows: false });
  assert.equal(cases.length, 3, "공통 조건 행은 TC가 아니다");
  assert.equal(cases[0]!.title, "제목 공란 검증");
  assert.deepEqual(cases[0]!.steps, ["제목을 지운다"]);
  assert.equal(cases[0]!.pre, "공통 사전 조건:\nBOS 로그인 후 프로모션 관리 진입\n\n정상 초안");
  assert.equal(cases[1]!.title, "등록 일시 정렬 클릭", "기존 파일의 첫 단계 대체 유지");
  assert.equal(cases[2]!.pre, "", "다른 시트에 공통 조건이 누출되지 않는다");
  assert.match(buildCases(workbook, { hiddenSheets: false, hiddenRows: true })[0]!.pre, /숨긴 조건/);
});
