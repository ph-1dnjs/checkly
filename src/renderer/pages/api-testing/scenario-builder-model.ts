import type { Json, Scenario, ValueBinding } from "../../../app/api-testing/shared/scenario";
import type { ApiOperation } from "../../../app/api-testing/shared/workspace";

export type Step = Scenario["steps"][number];
export type RequestArea = "pathParams" | "query" | "headers" | "cookies" | "body";
export type BindingArea = ValueBinding["area"];

/** Store a stable OpenAPI operation reference instead of copying its label. */
export function apiReference(operation: Pick<ApiOperation, "operationId" | "method" | "path">): Step["api"] {
  if (operation.operationId) return { operationId: operation.operationId };
  return { method: operation.method.toUpperCase() as Extract<Step["api"], { method: string }>["method"], path: operation.path };
}

export function moveStep(scenario: Scenario, index: number, offset: number): Scenario {
  const next = index + offset;
  if (next < 0 || next >= scenario.steps.length) return scenario;
  const steps = [...scenario.steps];
  const [step] = steps.splice(index, 1);
  steps.splice(next, 0, step);
  return { ...scenario, steps };
}

export function connectResponse(scenario: Scenario, from: number, to: number, pointer: string, variable: string, area: RequestArea, field: string, prefix = ""): Scenario {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to >= scenario.steps.length) throw new Error("현재 단계보다 앞선 응답을 선택하세요");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(variable) || ["constructor", "prototype"].includes(variable)) throw new Error("변수 이름은 영문으로 시작하고 영문·숫자·밑줄만 사용하세요");
  if (!/^(?:\/(?:[^~]|~[01])*)*$/.test(pointer)) throw new Error("응답 경로는 JSON Pointer 형식으로 입력하세요. 예: /data/id");
  if (!field || ["__proto__", "constructor", "prototype"].includes(field)) throw new Error("유효한 요청 필드 이름을 입력하세요");
  const target = `vars.${variable}`;
  if (Object.hasOwn(scenario.vars, variable) || scenario.steps.some(s => s.extract.some(e => e.target === target))) throw new Error("이미 사용 중인 변수 이름입니다. 다른 이름을 입력하거나 기존 변수 참조를 사용하세요");
  const previous = scenario.steps[to].request[area];
  if (previous !== undefined && (!previous || typeof previous !== "object" || Array.isArray(previous))) throw new Error("응답 연결은 객체 요청 본문의 최상위 필드에 지원합니다. 배열·전체 본문은 JSON 편집을 사용하세요");
  const reference = `${prefix}{{${target}}}`;
  const steps = scenario.steps.map((step, index) => index === from ? {
    ...step, extract: [...step.extract, { source: "body" as const, pointer, target, sensitive: false }],
  } : index === to ? {
    ...step, request: { ...step.request, [area]: { ...(previous as Record<string, Json> ?? {}), [field]: reference } },
  } : step);
  return { ...scenario, steps };
}

/** Connects any captured request/response value to a later request template. */
export function connectValue(scenario: Scenario, from: number, to: number, source: ValueBinding["source"], area: BindingArea, pointer: string | undefined, header: string | undefined, variable: string, targetArea: RequestArea, field: string, prefix = ""): Scenario {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= scenario.steps.length || to >= scenario.steps.length || from === to)
    throw new Error("값 출처 단계와 사용 단계는 서로 달라야 합니다");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(variable) || ["constructor", "prototype"].includes(variable)) throw new Error("변수 이름은 영문으로 시작하고 영문·숫자·밑줄만 사용하세요");
  if (source === "request" && (area === "header" || pointer === undefined)) throw new Error("요청 출처는 요청 영역과 JSON Pointer가 필요합니다");
  if (source === "response" && area !== "body" && area !== "header") throw new Error("응답 출처는 body 또는 header를 사용하세요");
  if (source === "response" && area === "body" && pointer === undefined) throw new Error("응답 본문 출처는 JSON Pointer가 필요합니다");
  if (source === "response" && area === "header" && !header) throw new Error("응답 헤더 이름이 필요합니다");
  if (source === "response" && area === "header" && pointer !== undefined) throw new Error("응답 헤더에는 JSON Pointer를 사용할 수 없습니다");
  if (Object.hasOwn(scenario.vars, variable) || scenario.valueBindings.some(binding => binding.name === variable) || scenario.steps.some(step => step.extract.some(extract => extract.target === `vars.${variable}`)))
    throw new Error("이미 사용 중인 변수 이름입니다. 다른 이름을 입력하거나 기존 변수 참조를 사용하세요");
  if (!field && targetArea !== "body") throw new Error("유효한 요청 필드 이름을 입력하세요");
  if (field && ["__proto__", "constructor", "prototype"].includes(field)) throw new Error("유효한 요청 필드 이름을 입력하세요");
  const current = scenario.steps[to].request[targetArea];
  const reference = `${prefix}{{vars.${variable}}}`;
  let request = { ...scenario.steps[to].request };
  if (targetArea === "body" && !field) {
    request.body = reference;
  } else {
    if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) throw new Error("연결 대상은 객체 요청의 필드로 지정하세요. 전체 본문은 본문 전체 연결을 사용하세요");
    request = { ...request, [targetArea]: { ...(current as Record<string, Json> ?? {}), [field]: reference } };
  }
  const binding = {
    name: variable, step: scenario.steps[from].id, source, area,
    ...(pointer !== undefined ? { pointer } : {}), ...(header ? { header } : {}),
    sensitive: /authorization|cookie|password|token|secret|api.?key|otp/i.test(variable) || area === "headers" || area === "cookies" || area === "header",
  } as ValueBinding;
  return {
    ...scenario,
    valueBindings: [...scenario.valueBindings, binding],
    steps: scenario.steps.map((step, index) => index === to ? { ...step, request } : step),
  };
}
