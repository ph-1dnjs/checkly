import { isDeepStrictEqual } from "node:util";
import { isProvidedScenarioInput, matchesScenarioInputType, scenarioInputType, scenarioSchema, scenarioStepInputs, scenarioStepLabel, type Scenario, type Json, type ScenarioInputRequest, type ValueBinding } from "../shared/scenario";
import type { ApiRequestTrace } from "../shared/workspace";
import { appendQueryParameter } from "../shared/query";
import { atPointer, GlobalStore, MissingValue, resolve, type Context, type Variables } from "./variables";
import { CookieJar } from "./cookies";

type Status = "passed" | "failed" | "blocked" | "skipped" | "cancelled";
type InputResult = { name: string; provided: boolean };
/** One response check: `expect` is its index in step.expect; absent = the automatic 2xx check. `actual` only for failures, shortened. */
export type CheckResult = { expect?: number; passed: boolean; actual?: string };
export type StepResult = { id: string; name: string; status: Status; durationMs: number; httpStatus?: number; error?: string; checks?: CheckResult[]; failure?: { kind: "http" | "assertion" | "extraction" | "request" | "input" | "other"; source?: "status" | "header" | "body"; operator?: "exists" | "equals" | "contains" | "includes" }; input?: InputResult; inputs?: InputResult[] };
export type RunResult = { status: Status; steps: StepResult[] };
export type RunOptions = {
  projectId: string; environment: string; servers: Record<string, { baseUrl: string }>;
  inputs?: Variables; signal?: AbortSignal; timeoutMs?: number; runId?: string;
  /** Shared session cookies; a fresh jar is used for this run when omitted. */
  cookies?: CookieJar;
  requestInput?: (request: ScenarioInputRequest) => Promise<Json | undefined>;
  onRequest?: (request: ApiRequestTrace, stepId: string) => void;
  onResponse?: (response: { headers: Record<string, string>; body: Json }, stepId: string) => void;
  onValue?: (value: Json, sensitive: boolean) => void;
  onVariables?: (variables: Variables) => void;
  resolveOperation?: (server: string, api: Scenario["steps"][number]["api"]) => { method: string; path: string; bodySchema?: Json; parameters?: Array<{ name: string; location: string; type: string; style?: string; explode?: boolean }> };
};

type ResponseSnapshot = { status: number; headers: Record<string, string>; body: Json };
type RequestSnapshot = NonNullable<Scenario["steps"][number]["request"]>;

class RequestValueError extends Error {}
class SafeCheckFailure extends Error {
  constructor(readonly failure: NonNullable<StepResult["failure"]>, message = "응답 검증 실패") { super(message); }
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function schemaType(value: unknown): string | undefined {
  const node = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (typeof node.type === "string") return node.type;
  if (node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)) return "object";
  const alternatives = [...(Array.isArray(node.oneOf) ? node.oneOf : []), ...(Array.isArray(node.anyOf) ? node.anyOf : [])]
    .map(schemaType).filter((type): type is string => Boolean(type));
  return alternatives.length > 0 && new Set(alternatives).size === 1 ? alternatives[0] : undefined;
}

function matchesSchemaType(value: unknown, expected: string, schema: unknown): boolean {
  if (value === null && schema && typeof schema === "object" && !Array.isArray(schema) && (schema as Record<string, unknown>).nullable === true) return true;
  return expected === "integer" ? typeof value === "number" && Number.isInteger(value) : jsonType(value) === expected;
}

function requestBindingHint(scenario: Scenario, field: string, value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(/^\{\{vars\.([A-Za-z][A-Za-z0-9_]*)\}\}$/);
  if (!match) return "";
  const binding = scenario.valueBindings.find(candidate => candidate.name === match[1]);
  if (!binding || binding.source !== "response" || binding.area !== "body") return "";
  const parent = binding.pointer ?? "";
  const escapedField = field.replace(/~/g, "~0").replace(/\//g, "~1");
  const suggested = `${parent}/${escapedField}`;
  return ` 현재 응답 연결 경로는 '${parent || "전체 응답"}'입니다. 응답 JSON의 '${field}' 키('${suggested}')를 선택하세요.`;
}

function validateRequestBody(scenario: Scenario, index: number, body: Json | undefined, bodySchema: Json | undefined): void {
  if (body === undefined || bodySchema === undefined) return;
  const schema = bodySchema && typeof bodySchema === "object" && !Array.isArray(bodySchema) ? bodySchema as Record<string, unknown> : {};
  const expectedBodyType = schemaType(schema);
  if (expectedBodyType && expectedBodyType !== "object" && !matchesSchemaType(body, expectedBodyType, schema))
    throw new RequestValueError(`요청 본문 형식 오류: 명세는 ${expectedBodyType}인데 현재 ${jsonType(body)}입니다.`);
  if (expectedBodyType !== "object" || !body || typeof body !== "object" || Array.isArray(body)) return;
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties as Record<string, unknown> : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
  const requestBody = body as Record<string, Json>;
  for (const field of required) {
    const fieldSchema = properties[field];
    if (fieldSchema && typeof fieldSchema === "object" && !Array.isArray(fieldSchema) && (fieldSchema as Record<string, unknown>).readOnly === true) continue;
    if (!Object.hasOwn(requestBody, field)) throw new RequestValueError(`필수 요청값 누락: body.${field}`);
  }
  for (const [field, rawSchema] of Object.entries(properties)) {
    if (!Object.hasOwn(requestBody, field)) continue;
    const expected = schemaType(rawSchema);
    if (!expected) continue;
    const actual = jsonType(requestBody[field]);
    const valid = matchesSchemaType(requestBody[field], expected, rawSchema);
    if (!valid) {
      const hint = requestBindingHint(scenario, field, scenario.steps[index].request.body && typeof scenario.steps[index].request.body === "object" && !Array.isArray(scenario.steps[index].request.body) ? (scenario.steps[index].request.body as Record<string, unknown>)[field] : undefined);
      throw new RequestValueError(`요청값 형식 오류: body.${field}는 ${expected}이어야 하지만 현재 ${actual}입니다.${hint}`);
    }
  }
}

function readBinding(binding: ValueBinding, requests: Map<string, RequestSnapshot>, responses: Map<string, ResponseSnapshot>): Json | undefined {
  if (binding.source === "request") {
    const request = requests.get(binding.step);
    if (!request) return undefined;
    const area = binding.area as "pathParams" | "query" | "headers" | "cookies" | "body";
    const value = request[area];
    return atPointer(value === undefined ? null : value as Json, binding.pointer ?? "");
  }
  const response = responses.get(binding.step);
  if (!response) return undefined;
  if (binding.area === "body") return atPointer(response.body, binding.pointer ?? "");
  const header = binding.header?.toLowerCase();
  if (!header) return undefined;
  const found = Object.entries(response.headers).find(([name]) => name.toLowerCase() === header);
  return found?.[1];
}

function applyBindings(scenario: Scenario, index: number, context: Context, requests: Map<string, RequestSnapshot>, responses: Map<string, ResponseSnapshot>, options: RunOptions): void {
  const indexes = new Map(scenario.steps.map((step, stepIndex) => [step.id, stepIndex]));
  for (const binding of scenario.valueBindings) {
    const sourceIndex = indexes.get(binding.step);
    if (sourceIndex === undefined || sourceIndex >= index) continue;
    const value = readBinding(binding, requests, responses);
    if (value === undefined) continue;
    context.vars[binding.name] = structuredClone(value);
    options.onValue?.(structuredClone(value), binding.sensitive);
  }
}

/** Use the same resolved URL for session-cookie checks and the outgoing request. */
export function resolveRequestUrl(baseUrl: string, apiPath: string, pathParams: Record<string, Json> = {}): URL {
  const path = apiPath.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = pathParams[key];
    if (value === undefined || value === null || typeof value === "object") throw new MissingValue(`경로 변수 오류: ${key}`);
    return encodeURIComponent(String(value));
  });
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error("잘못된 서버 주소");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) throw new Error("잘못된 API 경로");
  const url = new URL(base.toString().replace(/\/$/, "") + path);
  if (url.origin !== base.origin) throw new Error("API 서버 범위를 벗어난 경로");
  return url;
}

function addCookies(headers: Headers, cookies: Record<string, Json>, automatic: Record<string, string>): void {
  const values = [...Object.entries(automatic).filter(([name]) => !Object.hasOwn(cookies, name)), ...Object.entries(cookies)].map(([name, value]) => {
    if (!/^[^=;,\s]+$/.test(name) || value === null || typeof value === "object") throw new Error("쿠키는 단순 문자열·숫자·불리언만 지원합니다");
    const text = String(value);
    if (/[\r\n;]/.test(text)) throw new Error("쿠키 값에 사용할 수 없는 문자가 있습니다");
    return `${name}=${text}`;
  });
  if (!values.length) return;
  const existing = headers.get("cookie");
  headers.set("cookie", [existing, ...values].filter(Boolean).join("; "));
}

function waitForScenarioInput(options: RunOptions, request: ScenarioInputRequest): Promise<Json | undefined> {
  if (!options.requestInput) return Promise.resolve(undefined);
  const signal = options.signal;
  if (!signal) return options.requestInput(request);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const finish = (value: Json | undefined) => { if (settled) return; settled = true; cleanup(); resolve(value); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const onAbort = () => finish(undefined);
    if (signal.aborted) { finish(undefined); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    void options.requestInput!(request).then(finish, fail);
  });
}

/** Contains no raw request/response values; a masked trace adapter can be added for UI. */
export class ApiRunner {
  constructor(readonly globals = new GlobalStore()) {}

  async run(input: Scenario, options: RunOptions): Promise<RunResult> {
    const scenario = scenarioSchema.parse(input);
    const release = this.globals.acquire(options.projectId);
    try {
      const context: Context = { inputs: structuredClone(options.inputs ?? {}), vars: structuredClone(scenario.vars), globals: this.globals.snapshot(options.projectId) };
      for (const [key, definition] of Object.entries(scenario.inputs)) {
        const v = context.inputs[key];
        if (v === undefined && !definition.required) continue;
        const type = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
        if (type !== definition.type) throw new MissingValue(`입력 누락 또는 타입 오류: ${key}`);
      }
      const results: StepResult[] = [];
      const requestSnapshots = new Map<string, RequestSnapshot>();
      const responseSnapshots = new Map<string, ResponseSnapshot>();
      const cookieJar = options.cookies ?? new CookieJar();
      let stopped = false;
      for (const [index, step] of scenario.steps.entries()) {
        if (options.signal?.aborted || stopped) {
          results.push({ id: step.id, name: scenarioStepLabel(step), status: options.signal?.aborted ? "cancelled" : "skipped", durationMs: 0 });
          continue;
        }
        const started = Date.now();
        let httpStatus: number | undefined;
        let checks: CheckResult[] | undefined;
        const inputResults: InputResult[] = [];
        try {
          applyBindings(scenario, index, context, requestSnapshots, responseSnapshots, options);
          const server = options.servers[step.server];
          if (!server) throw new MissingValue(`API 서버 없음: ${step.server}`);
          const api = options.resolveOperation ? options.resolveOperation(step.server, step.api) : "operationId" in step.api ? undefined : step.api;
          if (!api) throw new MissingValue("operationId 명세 연결이 필요합니다");
          for (const input of scenarioStepInputs(step)) {
            let value: Json | undefined;
            if (Object.hasOwn(context.vars, input.name)) value = context.vars[input.name];
            else if (Object.hasOwn(context.inputs, input.name)) value = context.inputs[input.name];
            else if (Object.hasOwn(context.globals, input.name)) value = context.globals[input.name];
            if (!isProvidedScenarioInput(value)) value = await waitForScenarioInput(options, {
              ...input,
              runId: options.runId ?? "local-run",
              index,
              totalSteps: scenario.steps.length,
              stepId: step.id,
            });
            if (options.signal?.aborted) throw new Error("실행 취소");
            const provided = isProvidedScenarioInput(value);
            inputResults.push({ name: input.name, provided });
            if (!provided) {
              if (input.required) throw new MissingValue(`필수 실행 입력 누락: ${input.name}`);
            } else if (!matchesScenarioInputType(value, input.type)) {
              throw new MissingValue(`실행 입력 타입 오류: ${input.name} (${scenarioInputType(value)})`);
            } else {
              context.vars[input.name] = structuredClone(value!);
            }
          }
          const req = resolve(step.request as Json, context) as NonNullable<Scenario["steps"][number]["request"]>;
          requestSnapshots.set(step.id, structuredClone(req));
          const url = resolveRequestUrl(server.baseUrl, api.path, req.pathParams);
          for (const [key, v] of Object.entries(req.query ?? {})) {
            const parameter = "parameters" in api ? api.parameters?.find(candidate => candidate.location === "query" && candidate.name === key) : undefined;
            appendQueryParameter(url, key, v, parameter);
          }
          const headers = new Headers(req.headers);
          const auth = step.auth === "none" ? undefined : step.auth ?? scenario.auth;
          if (auth) {
            if (headers.has("authorization")) throw new Error("단계 인증과 Authorization 헤더가 중복됩니다. 하나만 설정하세요");
            const variable = auth.slice("globals.".length);
            const token = context.globals[variable];
            if (typeof token !== "string" || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) throw new MissingValue(`인증 전역변수 '${variable}'에 유효한 토큰이 없습니다`);
            headers.set("Authorization", `Bearer ${token}`);
          }
          addCookies(headers, req.cookies ?? {}, cookieJar.forUrl(url));
          if (req.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
          const requestTrace: ApiRequestTrace = {
            method: api.method,
            url: url.toString(),
            headers: Object.fromEntries(headers.entries()),
            ...(req.body !== undefined ? { body: structuredClone(req.body) } : {}),
          };
          options.onRequest?.(requestTrace, step.id);
          if (req.body !== undefined && /^(GET|HEAD)$/i.test(api.method)) throw new RequestValueError(`${api.method.toUpperCase()} 요청에는 본문을 보낼 수 없습니다. 단계의 요청 본문을 제거하세요.`);
          validateRequestBody(scenario, index, req.body, "bodySchema" in api ? api.bodySchema : undefined);
          const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 30_000), ...(options.signal ? [options.signal] : [])]);
          const response = await fetch(url, { method: api.method, headers, body: req.body === undefined ? undefined : JSON.stringify(req.body), signal, redirect: "manual" });
          httpStatus = response.status;
          cookieJar.store(url, response.headers);
          const text = await response.text();
          let body: Json = text;
          if (text) { try { body = JSON.parse(text); } catch { /* Non-JSON remains text. */ } }
          responseSnapshots.set(step.id, { status: response.status, headers: Object.fromEntries(response.headers.entries()), body });
          options.onResponse?.({ headers: Object.fromEntries(response.headers.entries()), body }, step.id);
          const read = (source: string, pointer?: string, header?: string): Json | undefined => source === "status" ? response.status : source === "header" ? response.headers.get(header!) ?? undefined : atPointer(body, pointer!);
          // Every check runs so the result can show each one; the step fails if any fails.
          const shown = (value: Json | undefined) => value === undefined ? "없음" : (JSON.stringify(value) ?? "없음").slice(0, 80);
          checks = [];
          let firstFailure: NonNullable<StepResult["failure"]> | undefined;
          if (!step.expect?.some(expectation => expectation.source === "status")) {
            const passed = response.status >= 200 && response.status < 300;
            checks.push({ passed, ...(passed ? {} : { actual: String(response.status) }) });
            if (!passed) firstFailure ??= { kind: "http", source: "status" };
          }
          for (const [index, check] of (step.expect ?? []).entries()) {
            const actual = read(check.source, check.pointer, check.header);
            const expected = check.value === undefined ? undefined : resolve(check.value, context);
            const passed = check.operator === "exists" ? actual !== undefined : check.operator === "equals" ? isDeepStrictEqual(actual, expected) : typeof actual === "string" && typeof expected === "string" ? actual.includes(expected) : Array.isArray(actual) && actual.some(v => isDeepStrictEqual(v, expected));
            checks.push({ expect: index, passed, ...(passed ? {} : { actual: shown(actual) }) });
            if (!passed) firstFailure ??= { kind: "assertion", source: check.source, operator: check.operator };
          }
          if (firstFailure) throw new SafeCheckFailure(firstFailure);
          const vars: Variables = {}, globals: Variables = {};
          for (const extraction of step.extract) {
            const v = read(extraction.source, extraction.pointer, extraction.header);
            // Names where the value was looked for, never the value itself.
            if (v === undefined) throw new SafeCheckFailure({ kind: "extraction", source: extraction.source }, `응답 저장 실패: ${extraction.source === "header" ? `응답 헤더 '${extraction.header}'` : `응답 본문 ${extraction.pointer || "전체"}`}에 값이 없어 ${extraction.target.startsWith("globals.") ? `전역변수 ${extraction.target.slice(8)}` : `값 변수 ${extraction.target.slice(5)}`}에 저장하지 못했습니다.`);
            const [scope, key] = extraction.target.split(".");
            Object.defineProperty(scope === "vars" ? vars : globals, key, { value: v, enumerable: true });
          }
          if (options.signal?.aborted) throw new Error("실행 취소");
          context.vars = { ...context.vars, ...vars };
          context.globals = { ...context.globals, ...globals };
          this.globals.commit(options.projectId, globals);
          results.push({ id: step.id, name: scenarioStepLabel(step), status: "passed", httpStatus, durationMs: Date.now() - started, ...(checks ? { checks } : {}), ...(inputResults.length === 1 ? { input: inputResults[0] } : inputResults.length > 1 ? { inputs: inputResults } : {}) });
        } catch (error) {
          const status = options.signal?.aborted ? "cancelled" : error instanceof MissingValue ? "blocked" : "failed";
          // Never surface network/library errors that could contain credentials or URLs.
          results.push({ id: step.id, name: scenarioStepLabel(step), status, httpStatus, durationMs: Date.now() - started, ...(checks ? { checks } : {}), ...(inputResults.length === 1 ? { input: inputResults[0] } : inputResults.length > 1 ? { inputs: inputResults } : {}), failure: error instanceof SafeCheckFailure ? error.failure : { kind: status === "blocked" ? "input" : error instanceof RequestValueError ? "request" : "other" }, error: status === "blocked" ? "필수 변수 또는 API 설정이 없습니다" : status === "cancelled" ? "실행 취소" : error instanceof RequestValueError || (error instanceof SafeCheckFailure && error.failure.kind === "extraction") ? error.message : error instanceof SafeCheckFailure ? (error.failure.kind === "http" ? `HTTP ${httpStatus} 응답 (2xx 아님)` : "응답 검증 실패") : httpStatus === undefined ? "요청을 보내지 못했습니다. 서버 주소·연결 상태나 단계 설정을 확인하세요." : "응답을 처리하지 못했습니다" });
          stopped = scenario.onFailure === "stop" || status === "cancelled";
        }
      }
      options.onVariables?.(structuredClone(context.vars));
      return { status: results.some(r => r.status === "cancelled") ? "cancelled" : results.some(r => r.status === "failed") ? "failed" : results.some(r => r.status === "blocked") ? "blocked" : "passed", steps: results };
    } finally { release(); }
  }
}
