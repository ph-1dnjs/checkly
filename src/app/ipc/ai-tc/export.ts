import ExcelJS from "exceljs";
import { VERDICT_LABEL, aggregate, type AiTcLiveVerdict, type AiTcRunState } from "./model";

/** 실행 결과와 실패 근거를 별도 시트로 만든다. 원본 엑셀은 바꾸지 않는다. */
export async function exportRunWorkbook(state: AiTcRunState, environment: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const verdicts = state.cases.map(item => aggregate(item.expected.map(expected => expected.verdict)));
  const statuses: AiTcLiveVerdict[] = ["pass", "fail", "blocked", "check", "pending", "na", "running", "waiting"];
  const colors: Record<AiTcLiveVerdict, string> = {
    pass: "E2F0D9", fail: "FCE4E4", blocked: "FCE8D5", check: "FFF2CC",
    pending: "E7E6E6", na: "E7E6E6", running: "DDEBF7", waiting: "DDEBF7",
  };
  const head = (sheet: ExcelJS.Worksheet, columns: Array<[string, number]>) => {
    sheet.columns = columns.map(([header, width]) => ({ header, width }));
    const header = sheet.getRow(1);
    header.height = 28;
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF243B53" } };
    header.alignment = { vertical: "middle", wrapText: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  };
  const mark = (cell: ExcelJS.Cell, verdict: AiTcLiveVerdict) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${colors[verdict]}` } };
    cell.font = { bold: true };
  };
  const summary = workbook.addWorksheet("요약");
  head(summary, [["항목", 22], ["값", 64]]);
  summary.addRows([
    ["실행 ID", state.runId], ["환경", environment], ["AI", state.provider], ["허용 도메인", state.allowedHosts.join(", ")],
    ["시작", state.startedAt], ["종료", state.endedAt ?? ""], ["실행 상태", state.status], ["전체 TC", state.cases.length],
  ]);
  for (const verdict of statuses) {
    const row = summary.addRow([VERDICT_LABEL[verdict], verdicts.filter(item => item === verdict).length]);
    mark(row.getCell(1), verdict);
  }
  if (state.usage) summary.addRows([["실행 입력 토큰", state.usage.input], ["실행 출력 토큰", state.usage.output], ["실행 캐시 읽기", state.usage.cachedInput], ["실행 캐시 생성", state.usage.cacheWrite], ["실행 사용량 미확인 호출", state.usage.unknown]]);
  if (state.preparationUsage) for (const provider of ["claude", "codex"] as const) {
    const usage = state.preparationUsage[provider];
    summary.addRows([[`준비 ${provider} 입력`, usage.input], [`준비 ${provider} 출력`, usage.output], [`준비 ${provider} 캐시 읽기`, usage.cached], [`준비 ${provider} 캐시 생성`, usage.write], [`준비 ${provider} 미확인 호출`, usage.unknown]]);
  }
  summary.addRow(["사용량 안내", "준비는 화면 세션 누계입니다. Claude 캐시 입력은 별도이며 Codex 캐시 읽기는 입력에 포함됩니다. 미확인 호출은 0 사용을 뜻하지 않습니다."]);
  const failures = workbook.addWorksheet("실패 상세");
  head(failures, [["TC ID", 18], ["시트", 18], ["행", 8], ["제목", 42], ["TC 사유", 40], ["기대 결과 번호", 14], ["기대 결과", 48], ["실제 관찰", 48], ["근거", 48], ["실패 동작", 48], ["캡처", 18], ["판정 시각", 18], ["판정 주체", 14], ["수정 이유", 30], ["시나리오 ID", 20], ["사전 조건", 45], ["테스트 단계", 60]]);
  for (const item of state.cases) {
    for (const entry of item.expected.filter(expected => expected.verdict === "fail")) {
      const failedActions = item.actions.filter(action => action.tone === "fail" && (!action.expected || action.expected === entry.id));
      failures.addRow([item.id, item.sheet, item.row, item.title, item.reason ?? "", entry.id, entry.text, entry.observation,
        entry.basis.map(basis => `${basis.k}: ${basis.v}`).join("\n"), failedActions.map(action => `${action.seq}. ${action.op} ${action.target}: ${action.result}`).join("\n"),
        entry.captureId ? `${entry.captureId}.jpg` : "", entry.at ?? "", { ai: "AI", automation: "자동 검증", system: "앱", user: "사용자" }[entry.by], entry.note ?? "", item.scenarioId ?? "", item.pre ?? "", item.steps?.join("\n") ?? ""]);
    }
  }
  const cases = workbook.addWorksheet("TC 결과");
  head(cases, [["TC ID", 18], ["시트", 18], ["행", 8], ["제목", 50], ["판정", 14], ["사유", 60], ["시작", 24], ["종료", 24], ["AI 응답 ms", 16], ["관찰 ms", 16], ["브라우저 ms", 16], ["입력 토큰", 16], ["출력 토큰", 16], ["캐시 읽기", 16], ["캐시 생성", 16], ["사용량 미확인 호출", 20]]);
  state.cases.forEach((item, index) => {
    const row = cases.addRow([item.id, item.sheet, item.row, item.title, VERDICT_LABEL[verdicts[index]!], item.reason ?? "", item.startedAt ?? "", item.endedAt ?? "", item.timing?.modelMs ?? "", item.timing?.observationMs ?? "", item.timing?.browserMs ?? "", item.usage?.input ?? "", item.usage?.output ?? "", item.usage?.cachedInput ?? "", item.usage?.cacheWrite ?? "", item.usage?.unknown ?? ""]);
    mark(row.getCell(5), verdicts[index]!);
  });
  const expected = workbook.addWorksheet("기대 결과");
  head(expected, [["TC ID", 18], ["번호", 8], ["기대 결과", 50], ["판정", 14], ["판정 주체", 14], ["원래 판정", 14], ["실제 관찰", 60], ["근거", 60], ["캡처", 18], ["시각", 18], ["수정 이유", 30]]);
  for (const item of state.cases) for (const entry of item.expected) {
    const row = expected.addRow([item.id, entry.id, entry.text, VERDICT_LABEL[entry.verdict], { ai: "AI", automation: "자동 검증", system: "앱", user: "사용자" }[entry.by], entry.original ? VERDICT_LABEL[entry.original] : "",
      entry.observation, entry.basis.map(basis => `${basis.k}: ${basis.v}`).join("\n"), entry.captureId ? `${entry.captureId}.jpg` : "", entry.at ?? "", entry.note ?? ""]);
    mark(row.getCell(4), entry.verdict);
  }
  const actions = workbook.addWorksheet("동작 이력");
  head(actions, [["TC ID", 18], ["순서", 8], ["시각", 18], ["기대 결과", 14], ["동작", 12], ["대상", 60], ["결과", 40], ["캡처", 18]]);
  for (const item of state.cases) for (const action of item.actions) actions.addRow([item.id, action.seq, action.at, action.expected ?? "", action.op, action.target, action.result, action.captureId ? `${action.captureId}.jpg` : ""]);
  for (const sheet of workbook.worksheets) sheet.eachRow((row, number) => {
    if (number > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
