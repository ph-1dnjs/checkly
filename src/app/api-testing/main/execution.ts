import { isDeepStrictEqual } from "node:util";
import { isProvidedScenarioInput, matchesScenarioInputType, scenarioInputType, scenarioSchema, scenarioStepInputs, scenarioStepLabel, type Scenario, type Json, type ScenarioInputRequest, type ValueBinding } from "../shared/scenario";
import type { ApiRequestTrace } from "../shared/workspace";
import { appendQueryParameter } from "../shared/query";
import { atPointer, GlobalStore, MissingValue, resolve, type Context, type Variables } from "./variables";

type Status = "passed" | "failed" | "blocked" | "skipped" | "cancelled";
type InputResult = { name: string; provided: boolean };
export type StepResult = { id: string; name: string; status: Status; durationMs: number; httpStatus?: number; error?: string; failure?: { kind: "http" | "assertion" | "extraction" | "request" | "input" | "other"; source?: "status" | "header" | "body"; operator?: "exists" | "equals" | "contains" | "includes" }; input?: InputResult; inputs?: InputResult[] };
export type RunResult = { status: Status; steps: StepResult[] };
export type RunOptions = {
  projectId: string; environment: string; servers: Record<string, { baseUrl: string }>;
  inputs?: Variables; signal?: AbortSignal; timeoutMs?: number; runId?: string;
  requestInput?: (request: ScenarioInputRequest) => Promise<Json | undefined>;
  onRequest?: (request: ApiRequestTrace, stepId: string) => void;
  onResponse?: (response: { headers: Record<string, string>; body: Json }, stepId: string) => void;
  onValue?: (value: Json, sensitive: boolean) => void;
  onVariables?: (variables: Variables) => void;
  resolveOperation?: (server: string, operationId: string) => { method: string; path: string; bodySchema?: Json; parameters?: Array<{ name: string; location: string; type: string; style?: string; explode?: boolean }> };
};

type ResponseSnapshot = { status: number; headers: Record<string, string>; body: Json };
type RequestSnapshot = NonNullable<Scenario["steps"][number]["request"]>;
type RuntimeCookie = { value: string; path: string; secure: boolean };
type CookieJar = Map<string, Map<string, RuntimeCookie>>;

class RequestValueError extends Error {}
class SafeCheckFailure extends Error {
  constructor(readonly failure: NonNullable<StepResult["failure"]>) { super("응답 검증 또는 값 추출 실패"); }
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
  if (bodySchema === undefined) return;
  const schema = bodySchema && typeof bodySchema === "object" && !Array.isArray(bodySchema) ? bodySchema as Record<string, unknown> : {};
  const expectedBodyType = schemaType(schema);
  if (expectedBodyType && expectedBodyType !== "object" && jsonType(body) !== expectedBodyType)
    throw new RequestValueError(`요청 본문 형식 오류: 명세는 ${expectedBodyType}인데 현재 ${jsonType(body)}입니다.`);
  if (expectedBodyType !== "object" || !body || typeof body !== "object" || Array.isArray(body)) return;
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties as Record<string, unknown> : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
  const requestBody = body as Record<string, Json>;
  for (const field of required) {
    if (!Object.hasOwn(requestBody, field)) throw new RequestValueError(`필수 요청값 누락: body.${field}`);
  }
  for (const [field, rawSchema] of Object.entries(properties)) {
    if (!Object.hasOwn(requestBody, field)) continue;
    const expected = schemaType(rawSchema);
    if (!expected) continue;
    const actual = jsonType(requestBody[field]);
    const valid = expected === "number" ? actual === "number" : expected === "integer" ? actual === "number" && Number.isInteger(requestBody[field] as number) : actual === expected;
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

function cookiePathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === "/") return true;
  if (requestPath === cookiePath) return true;
  return requestPath.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
}

function cookiesFor(jar: CookieJar, url: URL): Record<string, string> {
  const cookies = jar.get(url.origin);
  if (!cookies) return {};
  return Object.fromEntries([...cookies.entries()]
    .filter(([, cookie]) => (!cookie.secure || url.protocol === "https:") && cookiePathMatches(cookie.path, url.pathname || "/"))
    .map(([name, cookie]) => [name, cookie.value]));
}

function setCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") return extended.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/) : [];
}

function storeResponseCookies(jar: CookieJar, url: URL, headers: Headers): void {
  const responseCookies = setCookieHeaders(headers);
  if (!responseCookies.length) return;
  const cookies = jar.get(url.origin) ?? new Map<string, RuntimeCookie>();
  for (const raw of responseCookies) {
    const [pair, ...attributes] = raw.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!/^[^=;,\s]+$/.test(name) || /[\r\n;]/.test(value)) continue;
    let path = "/";
    let secure = false;
    let remove = false;
    for (const attribute of attributes) {
      const [rawName, ...rawValue] = attribute.trim().split("=");
      const attributeName = rawName.toLowerCase();
      const attributeValue = rawValue.join("=").trim();
      if (attributeName === "path" && attributeValue.startsWith("/")) path = attributeValue;
      if (attributeName === "secure") secure = true;
      if (attributeName === "max-age" && Number(attributeValue) <= 0) remove = true;
      if (attributeName === "expires" && Number.isFinite(Date.parse(attributeValue)) && Date.parse(attributeValue) <= Date.now()) remove = true;
    }
    if (remove || value === "") cookies.delete(name);
    else cookies.set(name, { value, path, secure });
  }
  if (cookies.size) jar.set(url.origin, cookies);
  else jar.delete(url.origin);
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
    const release = this.globals.acquire(options.projectId, options.environment);
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
      const cookieJar: CookieJar = new Map();
      let stopped = false;
      for (const [index, step] of scenario.steps.entries()) {
        if (options.signal?.aborted || stopped) {
          results.push({ id: step.id, name: scenarioStepLabel(step), status: options.signal?.aborted ? "cancelled" : "skipped", durationMs: 0 });
          continue;
        }
        const started = Date.now();
        let httpStatus: number | undefined;
        const inputResults: InputResult[] = [];
        try {
          applyBindings(scenario, index, context, requestSnapshots, responseSnapshots, options);
          const server = options.servers[step.server];
          if (!server) throw new MissingValue(`API 서버 없음: ${step.server}`);
          const api = ("operationId" in step.api ? options.resolveOperation?.(step.server, step.api.operationId) : step.api);
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
          const path = api.path.replace(/\{([^}]+)\}/g, (_, key) => {
            const v = req.pathParams?.[key];
            if (v === undefined || v === null || typeof v === "object") throw new MissingValue(`경로 변수 오류: ${key}`);
            return encodeURIComponent(String(v));
          });
          const base = new URL(server.baseUrl);
          if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash)
            throw new Error("잘못된 서버 주소");
          if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) throw new Error("잘못된 API 경로");
          const url = new URL(base.toString().replace(/\/$/, "") + path);
          if (url.origin !== base.origin) throw new Error("API 서버 범위를 벗어난 경로");
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
          addCookies(headers, req.cookies ?? {}, cookiesFor(cookieJar, url));
          if (req.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
          const requestTrace: ApiRequestTrace = {
            method: api.method,
            url: url.toString(),
            headers: Object.fromEntries(headers.entries()),
            ...(req.body !== undefined ? { body: structuredClone(req.body) } : {}),
          };
          options.onRequest?.(requestTrace, step.id);
          validateRequestBody(scenario, index, req.body, "bodySchema" in api ? api.bodySchema : undefined);
          const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 30_000), ...(options.signal ? [options.signal] : [])]);
          const response = await fetch(url, { method: api.method, headers, body: req.body === undefined ? undefined : JSON.stringify(req.body), signal, redirect: "manual" });
          httpStatus = response.status;
          storeResponseCookies(cookieJar, url, response.headers);
          const text = await response.text();
          let body: Json = text;
          if (text) { try { body = JSON.parse(text); } catch { /* Non-JSON remains text. */ } }
          responseSnapshots.set(step.id, { status: response.status, headers: Object.fromEntries(response.headers.entries()), body });
          options.onResponse?.({ headers: Object.fromEntries(response.headers.entries()), body }, step.id);
          const read = (source: string, pointer?: string, header?: string): Json | undefined => source === "status" ? response.status : source === "header" ? response.headers.get(header!) ?? undefined : atPointer(body, pointer!);
          if (!step.expect?.some(expectation => expectation.source === "status") && (response.status < 200 || response.status >= 300)) throw new SafeCheckFailure({ kind: "http", source: "status" });
          for (const check of step.expect ?? []) {
            const actual = read(check.source, check.pointer, check.header);
            const expected = check.value === undefined ? undefined : resolve(check.value, context);
            const passed = check.operator === "exists" ? actual !== undefined : check.operator === "equals" ? isDeepStrictEqual(actual, expected) : typeof actual === "string" && typeof expected === "string" ? actual.includes(expected) : Array.isArray(actual) && actual.some(v => isDeepStrictEqual(v, expected));
            if (!passed) throw new SafeCheckFailure({ kind: "assertion", source: check.source, operator: check.operator });
          }
          const vars: Variables = {}, globals: Variables = {};
          for (const extraction of step.extract) {
            const v = read(extraction.source, extraction.pointer, extraction.header);
            if (v === undefined) throw new SafeCheckFailure({ kind: "extraction", source: extraction.source });
            const [scope, key] = extraction.target.split(".");
            Object.defineProperty(scope === "vars" ? vars : globals, key, { value: v, enumerable: true });
          }
          if (options.signal?.aborted) throw new Error("실행 취소");
          context.vars = { ...context.vars, ...vars };
          context.globals = { ...context.globals, ...globals };
          this.globals.commit(options.projectId, globals);
          results.push({ id: step.id, name: scenarioStepLabel(step), status: "passed", httpStatus, durationMs: Date.now() - started, ...(inputResults.length === 1 ? { input: inputResults[0] } : inputResults.length > 1 ? { inputs: inputResults } : {}) });
        } catch (error) {
          const status = options.signal?.aborted ? "cancelled" : error instanceof MissingValue ? "blocked" : "failed";
          // Never surface network/library errors that could contain credentials or URLs.
          results.push({ id: step.id, name: scenarioStepLabel(step), status, httpStatus, durationMs: Date.now() - started, ...(inputResults.length === 1 ? { input: inputResults[0] } : inputResults.length > 1 ? { inputs: inputResults } : {}), failure: error instanceof SafeCheckFailure ? error.failure : { kind: status === "blocked" ? "input" : error instanceof RequestValueError ? "request" : "other" }, error: status === "blocked" ? "필수 변수 또는 API 설정이 없습니다" : status === "cancelled" ? "실행 취소" : error instanceof RequestValueError ? error.message : "요청·응답 검증 또는 값 추출 실패" });
          stopped = scenario.onFailure === "stop" || status === "cancelled";
        }
      }
      options.onVariables?.(structuredClone(context.vars));
      return { status: results.some(r => r.status === "cancelled") ? "cancelled" : results.some(r => r.status === "failed") ? "failed" : results.some(r => r.status === "blocked") ? "blocked" : "passed", steps: results };
    } finally { release(); }
  }
}
