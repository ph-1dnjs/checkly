import type { ApiScenarioResult } from "../../../../../app/api-testing/shared/workspace";
import type { Json } from "../../../../../app/api-testing/shared/scenario";
import { isSensitiveKey } from "../../../../../app/api-testing/shared/sensitive";

const kinds: Record<string, string> = { http: "HTTP 오류 상태", assertion: "검증 불일치", extraction: "값 추출 실패", request: "요청 실패(연결 등)", input: "실행 입력 없음", other: "기타 오류" };

/**
 * Where a run failed, for AI로 고치기: step number, name, kind and HTTP status only. Messages and values
 * stay out (they can carry response data); the AI finds the cause in the backend code.
 */
export function aiFixFailures(result: ApiScenarioResult): string[] {
  return result.steps.flatMap((step, index) => step.error || step.status === "failed"
    ? [`${index + 1}단계 '${step.name}' 실패 · ${kinds[step.failure?.kind ?? "other"] ?? kinds.other}${step.httpStatus ? ` · HTTP ${step.httpStatus}` : ""}`]
    : []);
}

/** Values under secret-looking keys (token, password, session…) replaced, at any depth. */
function masked(value: Json): Json {
  if (Array.isArray(value)) return value.map(masked);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isSensitiveKey(key) ? "***" : masked(item)]));
  return value;
}

/** The start of the first failed step's response body (secret-looking keys masked), sent only when the user allows it. */
export function aiFixResponse(result: ApiScenarioResult, limit = 2000): string | undefined {
  const step = result.steps.find(item => item.error || item.status === "failed");
  if (step?.body === undefined || step.body === null) return undefined;
  const text = typeof step.body === "string" ? step.body : JSON.stringify(masked(step.body), null, 1);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** A standalone prompt that focuses the external AI on correcting the Checkly scenario. */
export function aiFixPrompt(input: { scenarioName: string; request?: string; failures: string[]; response?: string }): string {
  return [
    "## 목표",
    `Checkly API 테스트 시나리오 '${input.scenarioName}'의 실패 원인을 시나리오 설정 관점에서 확인하고, 설정 오류라면 바로잡아 주세요.`,
    input.request?.trim() ? `추가 요청: ${input.request.trim()}` : "",
    input.failures.length ? `## 실패 정보\n${input.failures.map(item => `- ${item}`).join("\n")}` : "",
    input.response ? `실패 응답 (민감한 값은 가림 처리됨):\n${input.response}` : "",
    "## 확인",
    "Checkly MCP에서 시나리오와 관련 API 명세를 확인하고 다음을 비교하세요.",
    "- 실패 단계의 요청 필드와 입력값 참조",
    "- 앞 단계에서 준비하는 데이터와 시나리오 실행 순서",
    "- 기대 상태 코드와 응답 검증 조건",
    "4xx·5xx 응답도 의도된 실패 테스트일 수 있으므로, 응답 코드만으로 서버 문제라고 판단하지 마세요.",
    "## 수정 범위",
    "- 시나리오 설정 오류가 확인되면 필요한 부분만 수정하세요.",
    "- MCP로 수정할 수 있으면 YAML을 검증한 뒤 Checkly에 저장하세요.",
    "- MCP로 수정할 수 없으면 수정한 YAML 전문과 변경 이유를 제시하세요.",
    "- 백엔드 소스 코드와 테스트는 수정하지 말고, 시나리오도 실행하지 마세요.",
    "## 결과",
    "- 시나리오를 수정했다면 변경 내용과 저장 여부를 알려 주세요.",
    "- 시나리오가 명세와 일치한다면 비교 근거와 함께 서버 쪽 확인이 필요하다고 알려 주세요.",
    "",
  ].filter(Boolean).join("\n\n");
}

const wayKey = (projectId: string) => `checkly.api-testing.ai-way.${projectId}`;
const styleKey = (projectId: string) => `checkly.api-testing.ai-style.${projectId}`;
/** Opens the AI tab on 앱에서 AI와 대화 in the given style next time (where an AI에게 요청 shows its answer). */
export function showAiChat(projectId: string, style: "quick" | "terminal") {
  try { localStorage.setItem(wayKey(projectId), "chat"); localStorage.setItem(styleKey(projectId), style); } catch { /* only a convenience */ }
}
