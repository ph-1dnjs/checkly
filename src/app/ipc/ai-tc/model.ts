// AI TC 실행의 공용 모델. main(엑셀 읽기·실행기)과 renderer(검토·결과 화면)가 함께 쓰므로
// Node·Electron·DOM을 import하지 않는 순수 함수만 둔다. 정책: docs/ai-browser-tc-policy.md

/** 엑셀에서 읽는 TC 필드. 필수는 TC ID·테스트 단계·기대 결과. */
export type AiTcField = "id" | "scenarioId" | "kind" | "pre" | "steps" | "expected" | "data";

export const AI_TC_FIELDS: Array<{ field: AiTcField; label: string; required: boolean; aliases: string[] }> = [
  { field: "id", label: "TC ID", required: true, aliases: ["tcid", "테스트케이스id", "케이스id", "tc번호", "tcno"] },
  { field: "scenarioId", label: "시나리오 ID", required: false, aliases: ["시나리오id", "scenarioid", "시나리오번호"] },
  { field: "kind", label: "구분", required: false, aliases: ["구분", "분류", "유형", "category"] },
  { field: "pre", label: "사전 조건", required: false, aliases: ["사전조건", "전제조건", "precondition", "preconditions"] },
  { field: "steps", label: "테스트 단계", required: true, aliases: ["테스트단계", "테스트절차", "수행절차", "단계", "steps", "teststeps"] },
  { field: "expected", label: "기대 결과", required: true, aliases: ["기대결과", "예상결과", "expectedresult", "expected"] },
  { field: "data", label: "테스트 데이터", required: false, aliases: ["테스트데이터", "testdata", "입력데이터"] },
];

/** 엑셀 읽기 상한. 넘으면 가져오지 않고 이유를 알린다. */
export const AI_TC_LIMITS = { fileBytes: 20 * 1024 * 1024, sheets: 30, rowsPerSheet: 5000, columns: 100, cellChars: 10000 } as const;

/** 실행 한도 기본값. 실증 후 조정한다. */
export const AI_TC_RUN_LIMITS = { actionsPerCase: 40, minutesPerCase: 10, modelCalls: 300 } as const;

export type AiTcColumnMap = Partial<Record<AiTcField, number>>;

export type AiTcRawRow = {
  row: number;
  hidden: boolean;
  /** 열 번호(1부터) → 표시 텍스트 */
  cells: Record<number, string>;
  /** 병합 범위의 첫 칸이 아니어서 첫 칸 값을 이어받은 열 */
  mergedFrom: number[];
  /** 캐시된 표시값이 없는 수식 열 */
  formulaWithoutValue: number[];
};

export type AiTcSheet = {
  name: string;
  hidden: boolean;
  /** 머리글 행. 찾지 못하면 0이며 TC 시트가 아니다. */
  headerRow: number;
  headers: Array<{ col: number; label: string }>;
  rows: AiTcRawRow[];
  mapping: AiTcColumnMap;
};

export type AiTcWorkbook = { fileName: string; sheets: AiTcSheet[] };

export type AiTcExpected = { id: string; text: string };
export type AiTcDataNeed = { id: string; label: string; kind: "given" | "text" | "file"; value: string };

export type AiTcCase = {
  /** 파일·시트·행 출처로 만든 고유 키 */
  key: string;
  id: string;
  scenarioId: string;
  kind: string;
  title: string;
  pre: string;
  steps: string[];
  stepsRaw: string;
  expected: AiTcExpected[];
  expectedRaw: string;
  data: AiTcDataNeed[];
  sheet: string;
  row: number;
  /** 사전 조건에서 찾은 선행 TC 후보 */
  refs: string[];
  /** 실행을 막는 행 오류 */
  errors: string[];
  /** 실행은 가능하지만 검토가 필요한 점 */
  warnings: string[];
};

export type AiTcImportOptions = { hiddenSheets: boolean; hiddenRows: boolean };

const normalize = (text: string) => text.replace(/[\s_\-·.()/]/g, "").toLowerCase();

/** 머리글 이름으로 기본 매핑을 만든다. 정확히 같은 이름을 먼저, 그다음 별칭을 본다. */
export function guessMapping(headers: Array<{ col: number; label: string }>): AiTcColumnMap {
  const map: AiTcColumnMap = {};
  const used = new Set<number>();
  for (const { field, label, aliases } of AI_TC_FIELDS) {
    const names = [normalize(label), ...aliases];
    const hit = headers.find(header => !used.has(header.col) && names.includes(normalize(header.label)));
    if (hit) { map[field] = hit.col; used.add(hit.col); }
  }
  return map;
}

/** 처음 15행 안에서 TC ID와 기대 결과(또는 테스트 단계) 머리글이 함께 있는 행. */
export function findHeaderRow(rows: Array<{ row: number; cells: Record<number, string> }>): number {
  for (const item of rows.slice(0, 15)) {
    const map = guessMapping(Object.entries(item.cells).map(([col, label]) => ({ col: Number(col), label })));
    if (map.id && (map.expected || map.steps)) return item.row;
  }
  return 0;
}

const listMarker = /^\s*(?:\d{1,2}[.)]|[①-⑳]|[-•·*])\s*/;

/** 번호·글머리 목록은 항목별로 나눈다. 목록이 아니면 줄 단위로, 한 줄이면 그대로 둔다. */
export function splitItems(text: string): string[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    // 한 줄 안의 "1. 가 2. 나" 형태
    const inline = text.trim().split(/\s+(?=\d{1,2}[.)]\s)/).map(part => part.trim()).filter(Boolean);
    return inline.length > 1 ? inline.map(part => part.replace(listMarker, "").trim()) : lines;
  }
  if (!lines.some(line => listMarker.test(line))) return lines;
  // 번호가 없는 줄은 앞 항목에 이어 붙인다.
  const items: string[] = [];
  for (const line of lines) {
    if (listMarker.test(line) || !items.length) items.push(line.replace(listMarker, "").trim());
    else items[items.length - 1] += ` ${line}`;
  }
  return items.filter(Boolean);
}

const refPattern = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-TC\d+/gi;

/** 사전 조건에 적힌 TC ID 형태의 참조. 자기 자신은 뺀다. */
export function findRefs(pre: string, selfId: string): string[] {
  return [...new Set((pre.match(refPattern) ?? []).map(ref => ref.toUpperCase()))].filter(ref => ref !== selfId.toUpperCase());
}

/** 테스트 데이터 열의 값은 엑셀 원문으로 둔다. */
export function dataNeeds(input: { data: string; steps: string; pre: string }): AiTcDataNeed[] {
  // 입력값·업로드 파일은 준비 단계에서 AI가 TC·시나리오를 보고 세팅한다. 여기서는 엑셀 원문만 둔다.
  return input.data.trim() ? [{ id: "D1", label: "테스트 데이터", kind: "given", value: input.data.trim() }] : [];
}

const textOf = (row: AiTcRawRow, col: number | undefined) => (col ? row.cells[col] ?? "" : "").trim();

/** 시트들의 행을 TC로 바꾸고 빈 ID·중복 ID·빈 단계·빈 기대 결과를 행 오류로 표시한다. */
export function buildCases(workbook: AiTcWorkbook, options: AiTcImportOptions): AiTcCase[] {
  const cases: AiTcCase[] = [];
  for (const sheet of workbook.sheets) {
    if (!sheet.headerRow || (sheet.hidden && !options.hiddenSheets)) continue;
    const map = sheet.mapping;
    for (const row of sheet.rows) {
      if (row.row <= sheet.headerRow || (row.hidden && !options.hiddenRows)) continue;
      // TC ID·단계·기대 결과는 병합된 칸을 이어받지 않는다(같은 TC가 여러 행으로 늘어나지 않도록).
      const own = (field: AiTcField) => (map[field] && row.mergedFrom.includes(map[field]!) ? "" : textOf(row, map[field]));
      const id = own("id"), stepsRaw = own("steps"), expectedRaw = own("expected");
      const pre = textOf(row, map.pre), data = textOf(row, map.data);
      if (!id && !stepsRaw && !expectedRaw) continue;
      const steps = splitItems(stepsRaw);
      const expected = splitItems(expectedRaw).map((text, index) => ({ id: `E${index + 1}`, text }));
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!id) errors.push("빈 ID");
      if (!steps.length) errors.push("테스트 단계 없음");
      if (!expected.length) errors.push("기대 결과 없음");
      const formula = row.formulaWithoutValue.filter(col => Object.values(map).includes(col));
      if (formula.length) warnings.push("값이 없는 수식 칸");
      cases.push({
        key: `${workbook.fileName}:${sheet.name}:${row.row}`,
        id, scenarioId: textOf(row, map.scenarioId), kind: textOf(row, map.kind),
        title: steps[0] ?? stepsRaw, pre, steps, stepsRaw, expected, expectedRaw,
        data: dataNeeds({ data, steps: stepsRaw, pre }),
        sheet: sheet.name, row: row.row, refs: id ? findRefs(pre, id) : [], errors, warnings,
      });
    }
  }
  // 중복 판정은 파일 전체에서 한다. 처음 나온 행은 두고 뒤에 나온 행을 막는다.
  const seen = new Set<string>();
  for (const item of cases) {
    if (!item.id) continue;
    const upper = item.id.toUpperCase();
    if (seen.has(upper)) item.errors.push("중복 ID");
    seen.add(upper);
  }
  const ids = new Set(cases.filter(item => item.id && !item.errors.length).map(item => item.id.toUpperCase()));
  for (const item of cases) {
    const missing = item.refs.filter(ref => !ids.has(ref));
    if (missing.length) item.warnings.push(`파일에 없는 선행 TC ${missing.join(", ")}`);
  }
  return cases;
}

export const runnable = (item: AiTcCase) => !item.errors.length;

/** 선택 해제한 TC를 선행으로 둔 TC도 함께 해제한다. 함께 해제된 키를 돌려준다. */
export function cascadeDeselect(cases: AiTcCase[], selected: string[], remove: string[]): { selected: string[]; cascaded: string[] } {
  const byKey = new Map(cases.map(item => [item.key, item]));
  const out = new Set(remove);
  let changed = true;
  while (changed) {
    changed = false;
    const outIds = new Set([...out].map(key => byKey.get(key)?.id.toUpperCase()).filter(Boolean));
    for (const item of cases) {
      if (out.has(item.key) || !selected.includes(item.key)) continue;
      if (item.refs.some(ref => outIds.has(ref))) { out.add(item.key); changed = true; }
    }
  }
  return { selected: selected.filter(key => !out.has(key)), cascaded: [...out].filter(key => !remove.includes(key) && selected.includes(key)) };
}

/** 선행 확인 방식. link: 선택한 선행 TC 결과를 따른다 · ready: 이미 준비된 상태로 사용자가 확인했다. */
export type AiTcRefDecision = "link" | "ready";

/** 선택한 TC를 선행 관계에 맞춰 정렬한다. 선행으로 연결한 TC가 먼저 오고, 나머지는 파일 순서를 지킨다. 순환이면 null. */
export function orderCases(cases: AiTcCase[], refDecision: Record<string, AiTcRefDecision | undefined>): AiTcCase[] | null {
  const byId = new Map(cases.map(item => [item.id.toUpperCase(), item]));
  const order: AiTcCase[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (item: AiTcCase): boolean => {
    const mark = state.get(item.key);
    if (mark === "done") return true;
    if (mark === "visiting") return false;
    state.set(item.key, "visiting");
    if (refDecision[item.key] === "link") {
      for (const ref of item.refs) {
        const parent = byId.get(ref);
        if (parent && !visit(parent)) return false;
      }
    }
    state.set(item.key, "done");
    order.push(item);
    return true;
  };
  for (const item of cases) if (!visit(item)) return null;
  return order;
}

/** 기대 결과 상태. running·waiting은 실행 중 화면에만 쓴다. */
export type AiTcVerdict = "pass" | "fail" | "blocked" | "check" | "pending" | "na";
export type AiTcLiveVerdict = AiTcVerdict | "running" | "waiting";

export const VERDICT_LABEL: Record<AiTcLiveVerdict, string> = {
  pass: "Pass", fail: "Fail", blocked: "Blocked", check: "확인 필요", pending: "미실행", na: "N/A", running: "진행 중", waiting: "대기",
};

/** TC 집계: Fail 하나라도 → Fail, 그다음 Blocked → 확인 필요 → 미실행 → Pass. 모두 N/A면 N/A, Pass와 N/A는 Pass. */
export function aggregate(verdicts: AiTcLiveVerdict[]): AiTcLiveVerdict {
  if (!verdicts.length) return "pending";
  if (verdicts.includes("fail")) return "fail";
  for (const verdict of ["running", "waiting", "blocked", "check", "pending"] as const) if (verdicts.includes(verdict)) return verdict;
  if (verdicts.every(verdict => verdict === "na")) return "na";
  return "pass";
}

/** 되돌리기 어렵거나 외부 영향을 주는 동작으로 보는 대상 이름. 모델 표시와 별개로 앱이 한 번 더 확인한다. */
export const riskyTarget = /등록|저장|삭제|제거|결제|주문|구매|발송|전송|송신|승인|반려|탈퇴|해지|권한|초대|submit|save|delete|remove|pay|order|purchase|send|approve|confirm/i;

/** URL의 host가 허용 목록에 있는지. 하위 도메인은 따로 허용해야 한다. */
export function hostAllowed(url: string, allowedHosts: string[]): boolean {
  if (!url || url === "about:blank") return true;
  try {
    const host = new URL(url).host.toLowerCase();
    return allowedHosts.some(item => item.toLowerCase() === host);
  } catch { return false; }
}

export const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ""; } };

// ─── 실행 상태(main → renderer) ───

export type AiTcActionOp = "관찰" | "이동" | "클릭" | "입력" | "선택" | "키" | "스크롤" | "대기" | "업로드" | "판정" | "요청" | "인계";

export type AiTcActionLog = {
  seq: number;
  at: string;
  expected?: string;
  op: AiTcActionOp;
  target: string;
  result: string;
  tone?: "ok" | "wait" | "fail";
  captureId?: string;
};

export type AiTcExpectedResult = AiTcExpected & {
  verdict: AiTcLiveVerdict;
  observation: string;
  basis: Array<{ k: string; v: string }>;
  captureId?: string;
  at?: string;
  /** ai: 모델 판정 · system: 앱이 기록한 실행 불가 사유 · user: 사용자 수정 */
  by: "ai" | "system" | "user";
  /** 사용자가 바꾸기 전 판정 */
  original?: AiTcVerdict;
  note?: string;
};

export type AiTcCaseResult = {
  scenarioId?: string;
  pre?: string;
  steps?: string[];
  key: string;
  id: string;
  title: string;
  sheet: string;
  row: number;
  expected: AiTcExpectedResult[];
  actions: AiTcActionLog[];
  reason?: string;
  startedAt?: string;
  endedAt?: string;
};

export type AiTcWaitKind = "login" | "confirm" | "domain" | "popup" | "download" | "handoff";

export type AiTcWait = {
  kind: AiTcWaitKind;
  title: string;
  body: string;
  confirm?: { target: string; impact: string; url: string; expected: string };
};

export type AiTcRunStatus = "running" | "waiting" | "done" | "cancelled" | "error";

export type AiTcRunState = {
  runId: string;
  status: AiTcRunStatus;
  wait?: AiTcWait;
  error?: { message: string; retryable: boolean };
  current: number;
  url: string;
  outOfDomain: boolean;
  /** 로그인 등 민감 화면에서 캡처·AI 전송을 멈춘 상태 */
  capturePaused: boolean;
  highlight?: { x: number; y: number; w: number; h: number; label: string };
  cases: AiTcCaseResult[];
  budget: { actions: number; modelCalls: number; maxActions: number; maxModelCalls: number; maxMinutes: number; caseStartedAt?: string };
  provider: string;
  allowedHosts: string[];
  viewport: { width: number; height: number };
  capture: boolean;
  video: boolean;
  startedAt: string;
  endedAt?: string;
  /** 로컬 결과 파일 저장 실패 사유 */
  saveError?: string;
};

export type AiTcRunPlan = {
  cases: Array<{
    scenarioId?: string;
    key: string;
    id: string;
    title: string;
    pre: string;
    steps: string[];
    expected: AiTcExpected[];
    data: Array<{ label: string; value: string }>;
    files: Array<{ label: string; token: string; name: string }>;
    /** link일 때 이 TC들이 Pass가 아니면 Blocked */
    after: string[];
    /** 사용자가 이미 준비된 상태로 확인한 선행 TC */
    readyRefs: string[];
  }>;
  startUrl: string;
  allowedHosts: string[];
  capture: boolean;
  video: boolean;
  tool: "claude" | "codex";
  environmentLabel: string;
};

/** 사용자 대기에서 고른 조치. */
export type AiTcDecision = "resume" | "allow" | "handoff" | "block" | "stop";

/** 준비 단계에서 AI가 세팅한 TC별 입력값과 임시 업로드 파일. 사용자가 실행 전에 고칠 수 있다. */
export type AiTcPrepared = {
  key: string;
  data: Array<{ label: string; value: string }>;
  files: Array<{ label: string; token: string; name: string; spec: string }>;
  note: string;
};
