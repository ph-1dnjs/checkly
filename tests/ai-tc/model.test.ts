import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReply } from "../../src/app/ipc/ai-tc/ai";
import {
  aggregate, buildCases, cascadeDeselect, dataNeeds, findRefs, guessMapping, hostAllowed, orderCases, splitItems,
  type AiTcRawRow, type AiTcWorkbook,
} from "../../src/app/ipc/ai-tc/model";

const row = (n: number, cells: Record<number, string>, extra: Partial<AiTcRawRow> = {}): AiTcRawRow => ({ row: n, hidden: false, cells, mergedFrom: [], formulaWithoutValue: [], ...extra });
const headers = ["시나리오 ID", "TC ID", "구분", "사전 조건", "테스트 단계", "기대 결과", "테스트 데이터", "Chrome 결과"];
const workbook = (rows: AiTcRawRow[], hidden = false): AiTcWorkbook => {
  const header = headers.map((label, index) => ({ col: index + 1, label }));
  return {
    fileName: "QA.xlsx",
    sheets: [
      { name: "BOS_시나리오", hidden: false, headerRow: 0, headers: [], rows: [], mapping: {} },
      { name: "BOS_TC", hidden, headerRow: 3, headers: header, mapping: guessMapping(header), rows: [row(3, Object.fromEntries(header.map(item => [item.col, item.label]))), ...rows] },
    ],
  };
};

test("기본 열 매핑은 머리글 이름으로 찾고 참고 열은 매핑하지 않는다", () => {
  const map = guessMapping(headers.map((label, index) => ({ col: index + 1, label })));
  assert.deepEqual(map, { scenarioId: 1, id: 2, kind: 3, pre: 4, steps: 5, expected: 6, data: 7 });
});

test("번호 목록은 항목별로 나누고 번호 없는 줄은 앞 항목에 잇는다", () => {
  assert.deepEqual(splitItems("1. 목록이 표시된다\n2. 버튼이 노출된다\n   (상단)"), ["목록이 표시된다", "버튼이 노출된다 (상단)"]);
  assert.deepEqual(splitItems("1) 가 2) 나"), ["가", "나"]);
  assert.deepEqual(splitItems("한 줄 결과"), ["한 줄 결과"]);
  assert.deepEqual(splitItems("첫째\n둘째"), ["첫째", "둘째"]);
});

test("사전 조건의 TC ID를 선행 후보로 찾는다", () => {
  assert.deepEqual(findRefs("SC-01-TC01을 완료합니다.", "SC-01-TC02"), ["SC-01-TC01"]);
  assert.deepEqual(findRefs("로그인한 상태", "SC-01-TC02"), []);
});

test("빈 ID·중복 ID·빈 기대 결과는 행 오류이고 처음 나온 중복은 실행 가능하다", () => {
  const cases = buildCases(workbook([
    row(4, { 2: "SC-01-TC01", 5: "메뉴 클릭", 6: "1. 목록 표시\n2. 버튼 노출" }),
    row(5, { 2: "SC-01-TC02", 4: "SC-01-TC01을 완료합니다.", 5: "[신규 등록] 클릭", 6: "등록 화면이 열린다" }),
    row(6, { 2: "SC-01-TC01", 5: "특수문자 입력", 6: "안내 표시" }),
    row(7, { 5: "삭제 확인", 6: "목록에서 제거" }),
    row(8, { 2: "SC-02-TC03", 5: "[삭제] 클릭" }),
    row(9, { 2: "SC-09-TC01", 5: "숨김", 6: "보임" }, { hidden: true }),
  ]), { hiddenSheets: false, hiddenRows: false });
  assert.equal(cases.length, 5);
  assert.deepEqual(cases.map(item => item.errors), [[], [], ["중복 ID"], ["빈 ID"], ["기대 결과 없음"]]);
  assert.deepEqual(cases[0]!.expected.map(item => item.id), ["E1", "E2"]);
  assert.deepEqual(cases[1]!.refs, ["SC-01-TC01"]);
  assert.equal(cases[1]!.key, "QA.xlsx:BOS_TC:5");
  assert.equal(buildCases(workbook([row(9, { 2: "SC-09-TC01", 5: "숨김", 6: "보임" }, { hidden: true })]), { hiddenSheets: false, hiddenRows: true }).length, 1);
  assert.equal(buildCases(workbook([row(4, { 2: "A-TC1", 5: "s", 6: "e" })], true), { hiddenSheets: false, hiddenRows: false }).length, 0);
});

test("병합으로 이어받은 TC ID는 새 TC로 보지 않고, 값 없는 수식은 경고한다", () => {
  const cases = buildCases(workbook([
    row(4, { 1: "SC-01", 2: "SC-01-TC01", 5: "단계", 6: "결과" }),
    row(5, { 1: "SC-01", 2: "SC-01-TC01", 5: "추가 설명" }, { mergedFrom: [1, 2] }),
    row(6, { 2: "SC-01-TC02", 5: "단계", 6: "결과" }, { formulaWithoutValue: [6] }),
  ]), { hiddenSheets: false, hiddenRows: false });
  assert.deepEqual(cases.map(item => [item.id, item.errors]), [["SC-01-TC01", []], ["", ["빈 ID", "기대 결과 없음"]], ["SC-01-TC02", []]]);
  assert.deepEqual(cases[2]!.warnings, ["값이 없는 수식 칸"]);
});

test("단계 문구로 데이터를 추정하지 않고 테스트 데이터 열만 원문으로 둔다", () => {
  assert.deepEqual(dataNeeds({ data: "", steps: "이미지 파일을 선택한다", pre: "" }), []);
  assert.deepEqual(dataNeeds({ data: "가나다", steps: "상품 4개를 선택한다", pre: "" }).map(item => item.kind), ["given"]);
});

test("선행 TC를 해제하면 그 TC를 참조하는 선택도 함께 해제한다", () => {
  const cases = buildCases(workbook([
    row(4, { 2: "A-TC01", 5: "s", 6: "e" }),
    row(5, { 2: "A-TC02", 4: "A-TC01 완료", 5: "s", 6: "e" }),
    row(6, { 2: "A-TC03", 4: "A-TC02 완료", 5: "s", 6: "e" }),
    row(7, { 2: "B-TC01", 5: "s", 6: "e" }),
  ]), { hiddenSheets: false, hiddenRows: false });
  const keys = cases.map(item => item.key);
  const result = cascadeDeselect(cases, keys, [keys[0]!]);
  assert.deepEqual(result.selected, [keys[3]]);
  assert.deepEqual(result.cascaded, [keys[1], keys[2]]);
});

test("선행으로 연결한 TC가 먼저 오고 순환은 실행하지 않는다", () => {
  const cases = buildCases(workbook([
    row(4, { 2: "A-TC02", 4: "A-TC01 완료", 5: "s", 6: "e" }),
    row(5, { 2: "A-TC01", 5: "s", 6: "e" }),
  ]), { hiddenSheets: false, hiddenRows: false });
  assert.deepEqual(orderCases(cases, {})!.map(item => item.id), ["A-TC02", "A-TC01"]);
  assert.deepEqual(orderCases(cases, { [cases[0]!.key]: "link" })!.map(item => item.id), ["A-TC01", "A-TC02"]);
  const loop = buildCases(workbook([
    row(4, { 2: "A-TC01", 4: "A-TC02 완료", 5: "s", 6: "e" }),
    row(5, { 2: "A-TC02", 4: "A-TC01 완료", 5: "s", 6: "e" }),
  ]), { hiddenSheets: false, hiddenRows: false });
  assert.equal(orderCases(loop, Object.fromEntries(loop.map(item => [item.key, "link" as const]))), null);
});

test("TC 집계: Fail > Blocked > 확인 필요 > 미실행 > Pass, 모두 N/A면 N/A", () => {
  assert.equal(aggregate(["pass", "fail", "blocked"]), "fail");
  assert.equal(aggregate(["pass", "check", "blocked"]), "blocked");
  assert.equal(aggregate(["pass", "check", "pending"]), "check");
  assert.equal(aggregate(["pass", "pending"]), "pending");
  assert.equal(aggregate(["pass", "na"]), "pass");
  assert.equal(aggregate(["na", "na"]), "na");
  assert.equal(aggregate([]), "pending");
});

test("허용 도메인은 host가 정확히 같아야 한다", () => {
  assert.equal(hostAllowed("https://bos-qa.example.com/a", ["bos-qa.example.com"]), true);
  assert.equal(hostAllowed("https://m.example.com/", ["bos-qa.example.com", "www.example.com"]), false);
  assert.equal(hostAllowed("about:blank", []), true);
  assert.equal(hostAllowed("javascript:alert(1)", ["example.com"]), false);
});

test("모델 응답은 JSON 하나로 검증하고 허용되지 않은 동작·필드는 거부한다", () => {
  assert.equal(parseReply('설명\n{"thought":"x","action":{"type":"click","target":{"role":"button","name":"등록"}}}').reply?.action.type, "click");
  assert.match(parseReply('{"action":{"type":"shell","command":"rm -rf /"}}').error!, /action/);
  assert.match(parseReply('{"action":{"type":"click","target":{"role":"button"},"script":"x"}}').error!, /action/);
  assert.match(parseReply('{"action":{"type":"judge","expected":"E1","verdict":"pass","observation":"","basis":[]}}').error!, /observation/);
  assert.ok(parseReply("not json").error);
});
