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

/** A standalone, safe prompt for an external AI in the user's backend repository. */
export function aiFixPrompt(input: { scenarioName: string; request?: string; failures: string[]; response?: string }): string {
  return [
    `Checkly API 테스트 시나리오 '${input.scenarioName}' 실행이 실패했습니다. 백엔드 프로젝트에서 원인을 조사하고 필요한 서버 코드를 수정해 주세요.`,
    input.request?.trim() ? `추가 요청: ${input.request.trim()}` : "",
    input.failures.length ? `실패 정보:\n${input.failures.map(item => `- ${item}`).join("\n")}` : "",
    input.response ? `실패 응답 (민감한 값은 가림 처리됨):\n${input.response}` : "",
    "저장소의 관련 API 구현과 테스트를 확인하고, 수정 후 관련 테스트를 실행해 주세요. Checkly MCP가 연결되어 있으면 API 명세와 시나리오를 확인하는 데 사용해도 됩니다.",
    "",
  ].filter(Boolean).join("\n\n");
}

const wayKey = (projectId: string) => `checkly.api-testing.ai-way.${projectId}`;
const styleKey = (projectId: string) => `checkly.api-testing.ai-style.${projectId}`;
/** Opens the AI tab on 앱에서 AI와 대화 in the given style next time (where an AI에게 요청 shows its answer). */
export function showAiChat(projectId: string, style: "quick" | "terminal") {
  try { localStorage.setItem(wayKey(projectId), "chat"); localStorage.setItem(styleKey(projectId), style); } catch { /* only a convenience */ }
}
