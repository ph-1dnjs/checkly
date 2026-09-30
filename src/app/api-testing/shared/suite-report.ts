import type { ApiScenarioResult } from "./workspace";
import { describeCheck, type Scenario } from "./scenario";

/** `checkResults`: each check in words and whether it passed — never the actual response values. */
export type SuiteReportCheck = { label: string; passed: boolean };
export type SuiteReportStep = { name: string; reference: string; status: string; httpStatus?: number; durationMs: number; reason?: string; checks?: number; extractions?: number; checkResults?: SuiteReportCheck[] };
export type SuiteReportScenario = { id: string; name: string; status: string; durationMs: number; steps: SuiteReportStep[]; reason?: string };
export type SuiteReport = { suiteName: string; projectName: string; environmentName: string; startedAt: string; completedAt: string; status: string; scenarios: SuiteReportScenario[] };

export function producedGlobalNames(scenario: Scenario): string[] {
  return scenario.steps.flatMap(step => step.extract.filter(extract => extract.target.startsWith("globals.")).map(extract => extract.target.slice(8)));
}

export function usesInvalidatedGlobal(scenario: Scenario, names: ReadonlySet<string>): boolean {
  return [...names].some(name => scenario.auth === `globals.${name}` || scenario.steps.some(step => step.auth === `globals.${name}` || JSON.stringify({ request: step.request, expect: step.expect }).includes(`{{globals.${name}}}`)));
}

// This projection intentionally does not accept request, response, variables or raw errors.
// Report construction must remain independent of the on-screen sensitive-value toggle.
export function reportScenario(id: string, name: string, result: ApiScenarioResult, references: Array<{ name: string; reference: string }>, durationMs: number, scenario?: Scenario): SuiteReportScenario {
  return {
    id, name, status: result.status, durationMs,
    steps: result.steps.map((step, index) => { const expect = scenario?.steps.find(candidate => candidate.id === step.id)?.expect; return {
      name: references[index]?.name ?? step.name,
      reference: references[index]?.reference ?? "API",
      status: step.status,
      ...(scenario ? { checks: scenario.steps.find(candidate => candidate.id === step.id)?.expect?.length ?? 0, extractions: scenario.steps.find(candidate => candidate.id === step.id)?.extract.length ?? 0 } : {}),
      ...(step.httpStatus !== undefined ? { httpStatus: step.httpStatus } : {}),
      durationMs: step.durationMs,
      ...(["failed", "blocked", "cancelled"].includes(step.status) ? { reason: safeFailureReason(step.status, step.httpStatus, step.failure) } : {}),
      ...(step.checks?.length ? { checkResults: step.checks.map(check => { const { target, rule } = describeCheck(check.expect === undefined ? undefined : expect?.[check.expect]); return { label: `${target} ${rule}`, passed: check.passed }; }) } : {}),
    }; }),
  };
}

export function safeFailureReason(status: string, httpStatus?: number, failure?: ApiScenarioResult["steps"][number]["failure"]): string {
  if (status === "blocked") return "필수 입력·전역변수 또는 API 설정을 확인하세요.";
  if (status === "cancelled") return "사용자가 실행을 취소했습니다.";
  if (failure?.kind === "assertion") return `${failure.source === "status" ? "HTTP 상태" : failure.source === "header" ? "응답 헤더" : "응답 본문"} ${failure.operator === "equals" ? "일치" : failure.operator === "exists" ? "존재" : failure.operator === "contains" ? "포함" : "포함"} 검증 실패`;
  if (failure?.kind === "extraction") return `${failure.source === "header" ? "응답 헤더" : "응답 본문"}에서 저장할 값을 찾지 못했습니다.`;
  if (failure?.kind === "request") return "요청값 형식이 API 명세와 다릅니다.";
  if (failure?.kind === "input") return "필수 실행 입력이나 전역변수를 확인하세요.";
  if (failure?.kind === "http") return httpStatus === undefined ? "HTTP 요청에 실패했습니다." : `HTTP ${httpStatus} 응답`;
  if (httpStatus !== undefined && (httpStatus < 200 || httpStatus >= 300)) return `HTTP ${httpStatus} 응답 또는 검증 실패`;
  return httpStatus === undefined ? "요청을 보내지 못했습니다." : "응답을 처리하지 못했습니다.";
}

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const statusLabel = (status: string) => ({ passed: "통과", failed: "실패", blocked: "설정 필요", cancelled: "취소", skipped: "건너뜀" })[status as "passed"] ?? "미확인";
const statusClass = (status: string) => ["passed", "failed", "blocked", "cancelled", "skipped"].includes(status) ? status : "unknown";

export function renderSuiteReport(report: SuiteReport): string {
  const count = (status: string) => report.scenarios.filter(item => item.status === status).length;
  const elapsed = Math.max(0, Date.parse(report.completedAt) - Date.parse(report.startedAt));
  const displayTime = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString("ko-KR");
  const stepCounts = report.scenarios.flatMap(item => item.steps).reduce((counts, step) => {
    counts[step.status] = (counts[step.status] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const failed = report.scenarios.flatMap((scenario, index) => scenario.status === "passed" || scenario.status === "skipped" ? [] : [{ scenario, index }]);
  const occurrences = new Map<string, { count: number; firstMs: number }>();
  const cards = report.scenarios.map((scenario, index) => {
    const previous = occurrences.get(scenario.id);
    occurrences.set(scenario.id, { count: (previous?.count ?? 0) + 1, firstMs: previous?.firstMs ?? scenario.durationMs });
    const repeat = previous ? `<span class="repeat">${previous.count + 1}회차 · 첫 실행 대비 ${scenario.durationMs - previous.firstMs >= 0 ? "+" : ""}${scenario.durationMs - previous.firstMs}ms</span>` : "";
    const firstProblem = scenario.steps.findIndex(step => ["failed", "blocked", "cancelled"].includes(step.status));
    const problem = scenario.reason ?? (firstProblem >= 0 ? `${firstProblem + 1}단계 · ${scenario.steps[firstProblem].reason ?? statusLabel(scenario.steps[firstProblem].status)}` : "");
    return `<section class="scenario" id="scenario-${index + 1}">
      <div class="scenario-head"><div><span class="eyebrow">시나리오 ${index + 1}${repeat ? ` · ${repeat}` : ""}</span><h2>${escapeHtml(scenario.name)}</h2></div><span class="status ${statusClass(scenario.status)}">${statusLabel(scenario.status)}</span></div>
      <p class="meta">${scenario.steps.length}개 API · ${(scenario.durationMs / 1000).toFixed(2)}초</p>
      ${problem ? `<p class="problem">${escapeHtml(problem)}</p>` : ""}
      <div class="steps">${scenario.steps.map((step, stepIndex) => `<div class="step"><span class="index">${stepIndex + 1}</span><div><strong>${escapeHtml(step.reference)}</strong><small>${escapeHtml(step.name)}</small>${step.checkResults?.length ? `<ul class="checks">${step.checkResults.map(check => `<li class="${check.passed ? "pass" : "fail"}">${check.passed ? "✓" : "✗"} ${escapeHtml(check.label)}</li>`).join("")}</ul>` : step.checks || step.extractions ? `<small class="configured">검증 ${step.checks ?? 0}개 · 값 저장 ${step.extractions ?? 0}개 설정</small>` : ""}${step.reason ? `<p class="reason">${escapeHtml(step.reason)}</p>` : ""}</div><div class="step-end"><span class="status ${statusClass(step.status)}">${statusLabel(step.status)}</span><small>${step.httpStatus !== undefined ? `HTTP ${step.httpStatus} · ` : ""}${step.durationMs}ms</small></div></div>`).join("") || `<p class="empty">실행된 단계가 없습니다.</p>`}</div>
    </section>`;
  }).join("");
  const metrics = [
    [report.scenarios.length, "전체"], [count("passed"), "통과"], [count("failed"), "실패"],
    [count("blocked"), "설정 필요"], [count("cancelled"), "취소"], [count("skipped"), "건너뜀"],
  ].map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
  const issueList = failed.length ? `<section class="issues"><h2>확인이 필요한 항목</h2><ol>${failed.map(({ scenario, index }) => {
    const stepIndex = scenario.steps.findIndex(step => ["failed", "blocked", "cancelled"].includes(step.status));
    const reason = scenario.reason ?? (stepIndex >= 0 ? `${stepIndex + 1}단계 · ${scenario.steps[stepIndex].reason ?? statusLabel(scenario.steps[stepIndex].status)}` : statusLabel(scenario.status));
    return `<li><a href="#scenario-${index + 1}">${index + 1}. ${escapeHtml(scenario.name)}</a><span>${escapeHtml(reason)}</span></li>`;
  }).join("")}</ol></section>` : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.suiteName)} · API 테스트 리포트</title><style>
    :root{font-family:system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif;color:#182635;background:#f3f6f9}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:48px 28px 80px}.cover{background:#142737;color:white;padding:38px;border-radius:18px}.eyebrow{text-transform:uppercase;font-size:12px;font-weight:700;letter-spacing:.08em;color:#718599}.cover .eyebrow{color:#9fc8dc}h1{font-size:32px;margin:10px 0 14px;overflow-wrap:anywhere}h2{font-size:20px;margin:6px 0 0;overflow-wrap:anywhere}.cover p{color:#d1e0e8;margin:0;line-height:1.7}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:20px 0}.metric{background:white;border:1px solid #dae3ea;border-radius:12px;padding:16px}.metric strong{display:block;font-size:25px}.metric span,.meta,.step small,.overview{color:#657589;font-size:13px}.overview{margin:0 0 30px}.issues{background:#fff;border:1px solid #e8c7b9;border-left:4px solid #bf583a;border-radius:10px;padding:20px 24px;margin-bottom:30px}.issues h2{margin:0 0 12px}.issues ol{margin:0;padding-left:22px}.issues li{padding:6px 0;overflow-wrap:anywhere}.issues a{font-weight:700;color:#174d69}.issues span{display:block;font-size:13px;color:#80513e}.section-title{display:flex;justify-content:space-between;align-items:center;margin:0 0 16px}.section-title h2{margin:0}.scenario{background:white;border:1px solid #d9e3ea;border-radius:14px;margin:14px 0;padding:22px;break-inside:avoid}.scenario-head{display:flex;justify-content:space-between;gap:20px;align-items:start}.meta{margin:12px 0}.repeat{color:#315e77}.problem{background:#fff4ee;color:#8a331f;padding:10px 12px;border-radius:7px;font-size:13px;overflow-wrap:anywhere}.steps{border-top:1px solid #e5ebf0;margin-top:18px}.step{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:12px;padding:15px 0;border-bottom:1px solid #edf1f4;align-items:start}.step:last-child{border-bottom:0}.step strong,.step small{display:block;overflow-wrap:anywhere}.step small{margin-top:3px}.step .configured{margin-top:7px}.index{border-radius:50%;width:25px;height:25px;background:#edf3f6;text-align:center;line-height:25px;color:#526879;font-size:12px}.step-end{text-align:right}.status{display:inline-block;border-radius:99px;padding:5px 10px;font-size:12px;font-weight:700;white-space:nowrap;background:#e9edf1;color:#52606e}.status.passed{background:#e6f5ec;color:#12643a}.status.failed{background:#fdeaea;color:#a32020}.status.blocked{background:#fff1d8;color:#855400}.status.cancelled{background:#e8edf4;color:#495b70}.reason{font-size:13px;color:#9b2a2a;margin:7px 0 0}.empty{color:#657589}footer{margin-top:32px;color:#657589;font-size:12px;line-height:1.6}@media(max-width:700px){main{padding:20px 12px}.cover{padding:24px}.summary{grid-template-columns:repeat(3,1fr)}.scenario{padding:16px}.step{grid-template-columns:26px minmax(0,1fr)}.step-end{grid-column:2;text-align:left}}@media print{:root{background:white}main{padding:0}.cover,.scenario,.metric{box-shadow:none}.cover{print-color-adjust:exact}.scenario{break-inside:avoid}.issues a{color:#182635;text-decoration:none}}
  .checks{list-style:none;margin:6px 0 0;padding:0;font-size:12px;line-height:1.7}.checks .pass{color:#1e7a4a}.checks .fail{color:#b32318;font-weight:600}</style></head><body><main><header class="cover"><div class="eyebrow">Checkly · API TEST REPORT</div><h1>${escapeHtml(report.suiteName)}</h1><p>${escapeHtml(report.projectName)} · ${escapeHtml(report.environmentName)}<br>시작 ${escapeHtml(displayTime(report.startedAt))} · 완료 ${escapeHtml(displayTime(report.completedAt))} · 총 ${(elapsed / 1000).toFixed(2)}초</p></header><div class="summary">${metrics}</div><p class="overview">API 단계 ${Object.values(stepCounts).reduce((sum, value) => sum + value, 0)}개 · 통과 ${stepCounts.passed ?? 0} · 실패 ${stepCounts.failed ?? 0} · 설정 필요 ${stepCounts.blocked ?? 0} · 취소 ${stepCounts.cancelled ?? 0} · 건너뜀 ${stepCounts.skipped ?? 0}</p>${issueList}<div class="section-title"><h2>실행 결과</h2><span class="status ${statusClass(report.status)}">${statusLabel(report.status)}</span></div>${cards}<footer>검증·값 저장 개수는 설정 항목 수이며 개별 성공 건수를 뜻하지 않습니다. 요청·응답 원문, 인증 헤더, 변수 값은 이 리포트에 기록하지 않습니다. 시나리오 이름과 API 경로는 표시되므로 외부 공유 전에 확인하세요.</footer></main></body></html>`;
}
