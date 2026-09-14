import { isDeepStrictEqual } from "node:util";
import { isProvidedScenarioInput, matchesScenarioInputType, scenarioInputType, scenarioSchema, scenarioStepLabel, type Scenario, type Json, type ScenarioInputRequest, type ValueBinding } from "../shared/scenario";
import { atPointer, GlobalStore, MissingValue, resolve, type Context, type Variables } from "./variables";

type Status = "passed" | "failed" | "blocked" | "skipped" | "cancelled";
export type StepResult = { id: string; name: string; status: Status; durationMs: number; httpStatus?: number; error?: string; input?: { name: string; provided: boolean } };
export type RunResult = { status: Status; steps: StepResult[] };
export type RunOptions = {
  projectId: string; environment: string; servers: Record<string, { baseUrl: string }>;
  inputs?: Variables; signal?: AbortSignal; timeoutMs?: number; runId?: string;
  requestInput?: (request: ScenarioInputRequest) => Promise<Json | undefined>;
  onResponse?: (response: { headers: Record<string, string>; body: Json }, stepId: string) => void;
  onValue?: (value: Json, sensitive: boolean) => void;
  onVariables?: (variables: Variables) => void;
  resolveOperation?: (server: string, operationId: string) => { method: string; path: string };
};

type ResponseSnapshot = { status: number; headers: Record<string, string>; body: Json };
type RequestSnapshot = NonNullable<Scenario["steps"][number]["request"]>;

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

function addCookies(headers: Headers, cookies: Record<string, Json>): void {
  const values = Object.entries(cookies).map(([name, value]) => {
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
      const context: Context = { inputs: structuredClone(options.inputs ?? {}), vars: structuredClone(scenario.vars), globals: this.globals.snapshot(options.projectId, options.environment) };
      for (const [key, definition] of Object.entries(scenario.inputs)) {
        const v = context.inputs[key];
        if (v === undefined && !definition.required) continue;
        const type = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
        if (type !== definition.type) throw new MissingValue(`입력 누락 또는 타입 오류: ${key}`);
      }
      const results: StepResult[] = [];
      const requestSnapshots = new Map<string, RequestSnapshot>();
      const responseSnapshots = new Map<string, ResponseSnapshot>();
      let stopped = false;
      for (const [index, step] of scenario.steps.entries()) {
        if (options.signal?.aborted || stopped) {
          results.push({ id: step.id, name: scenarioStepLabel(step), status: options.signal?.aborted ? "cancelled" : "skipped", durationMs: 0 });
          continue;
        }
        const started = Date.now();
        let httpStatus: number | undefined;
        let inputResult: StepResult["input"];
        try {
          applyBindings(scenario, index, context, requestSnapshots, responseSnapshots, options);
          const server = options.servers[step.server];
          if (!server) throw new MissingValue(`API 서버 없음: ${step.server}`);
          const api = "operationId" in step.api ? options.resolveOperation?.(step.server, step.api.operationId) : step.api;
          if (!api) throw new MissingValue("operationId 명세 연결이 필요합니다");
          if (step.input) {
            let value: Json | undefined;
            if (Object.hasOwn(context.vars, step.input.name)) value = context.vars[step.input.name];
            else if (Object.hasOwn(context.inputs, step.input.name)) value = context.inputs[step.input.name];
            else if (Object.hasOwn(context.globals, step.input.name)) value = context.globals[step.input.name];
            if (!isProvidedScenarioInput(value)) value = await waitForScenarioInput(options, {
              ...step.input,
              runId: options.runId ?? "local-run",
              index: scenario.steps.indexOf(step),
              totalSteps: scenario.steps.length,
              stepId: step.id,
            });
            if (options.signal?.aborted) throw new Error("실행 취소");
            const provided = isProvidedScenarioInput(value);
            inputResult = { name: step.input.name, provided };
            if (!provided) {
              if (step.input.required) throw new MissingValue(`필수 실행 입력 누락: ${step.input.name}`);
            } else if (!matchesScenarioInputType(value, step.input.type)) {
              throw new MissingValue(`실행 입력 타입 오류: ${step.input.name} (${scenarioInputType(value)})`);
            } else {
              context.vars[step.input.name] = structuredClone(value!);
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
            if (typeof v === "object") throw new Error("쿼리는 단일 문자열·숫자·불리언만 지원합니다");
            url.searchParams.set(key, String(v));
          }
          const headers = new Headers(req.headers);
          addCookies(headers, req.cookies ?? {});
          if (req.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
          const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 30_000), ...(options.signal ? [options.signal] : [])]);
          const response = await fetch(url, { method: api.method, headers, body: req.body === undefined ? undefined : JSON.stringify(req.body), signal, redirect: "manual" });
          httpStatus = response.status;
          const text = await response.text();
          let body: Json = text;
          if (text) { try { body = JSON.parse(text); } catch { /* Non-JSON remains text. */ } }
          responseSnapshots.set(step.id, { status: response.status, headers: Object.fromEntries(response.headers.entries()), body });
          options.onResponse?.({ headers: Object.fromEntries(response.headers.entries()), body }, step.id);
          const read = (source: string, pointer?: string, header?: string): Json | undefined => source === "status" ? response.status : source === "header" ? response.headers.get(header!) ?? undefined : atPointer(body, pointer!);
          if (!step.expect?.some(expectation => expectation.source === "status") && (response.status < 200 || response.status >= 300)) throw new Error("HTTP 성공 상태가 아닙니다");
          for (const check of step.expect ?? []) {
            const actual = read(check.source, check.pointer, check.header);
            const expected = check.value === undefined ? undefined : resolve(check.value, context);
            const passed = check.operator === "exists" ? actual !== undefined : check.operator === "equals" ? isDeepStrictEqual(actual, expected) : typeof actual === "string" && typeof expected === "string" ? actual.includes(expected) : Array.isArray(actual) && actual.some(v => isDeepStrictEqual(v, expected));
            if (!passed) throw new Error(`응답 검증 실패: ${check.source} ${check.operator}`);
          }
          const vars: Variables = {}, globals: Variables = {};
          for (const extraction of step.extract) {
            const v = read(extraction.source, extraction.pointer, extraction.header);
            if (v === undefined) throw new Error("응답에서 필수 추출 값을 찾을 수 없습니다");
            const [scope, key] = extraction.target.split(".");
            Object.defineProperty(scope === "vars" ? vars : globals, key, { value: v, enumerable: true });
          }
          if (options.signal?.aborted) throw new Error("실행 취소");
          context.vars = { ...context.vars, ...vars };
          context.globals = { ...context.globals, ...globals };
          this.globals.commit(options.projectId, options.environment, globals);
          results.push({ id: step.id, name: scenarioStepLabel(step), status: "passed", httpStatus, durationMs: Date.now() - started, ...(inputResult ? { input: inputResult } : {}) });
        } catch (error) {
          const status = options.signal?.aborted ? "cancelled" : error instanceof MissingValue ? "blocked" : "failed";
          // Never surface network/library errors that could contain credentials or URLs.
          results.push({ id: step.id, name: scenarioStepLabel(step), status, httpStatus, durationMs: Date.now() - started, ...(inputResult ? { input: inputResult } : {}), error: status === "blocked" ? "필수 변수 또는 API 설정이 없습니다" : status === "cancelled" ? "실행 취소" : "요청·응답 검증 또는 값 추출 실패" });
          stopped = scenario.onFailure === "stop" || status === "cancelled";
        }
      }
      options.onVariables?.(structuredClone(context.vars));
      return { status: results.some(r => r.status === "cancelled") ? "cancelled" : results.some(r => r.status === "failed") ? "failed" : results.some(r => r.status === "blocked") ? "blocked" : "passed", steps: results };
    } finally { release(); }
  }
}
