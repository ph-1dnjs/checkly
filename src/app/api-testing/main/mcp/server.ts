import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync, linkSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { releaseStaleDiscovery } from "./discovery";
import type { ApiWorkspace } from "../workspace";
import { aiCatalogDetails, withGeneratedId } from "../ai-context";
import type { ApiEnvironmentScope, ApiMcpRunEvent, ApiMcpStatus, ApiScenarioResult, SavedApiScenario } from "../../shared/workspace";
import { describeCheck, parseScenario, type Scenario } from "../../shared/scenario";
import { producedGlobalNames } from "../../shared/suite-report";

const connectionSchema = z.object({ projectId: z.string().uuid(), environmentId: z.string().uuid() }).strict();
const sourceSchema = { source: z.string().min(1).max(200_000), bindings: z.record(z.string(), z.string().uuid()).default({}) };
type Run = { controller: AbortController; state: string; result?: unknown };
/** Asks the person at the app, never the AI client. Resolves false when declined, timed out or aborted. */
export type ApiMcpConfirm = (request: { title: string; detail: string; signal: AbortSignal }) => Promise<boolean>;
export type ApiMcpHooks = { confirm?: ApiMcpConfirm; onRun?: (event: ApiMcpRunEvent) => void };
// Tests shorten the wait so a real dialog is on screen only briefly.
const CONFIRM_TIMEOUT_MS = Number(process.env.CHECKLY_MCP_CONFIRM_TIMEOUT_MS) || 45_000;

/** One explicit project/environment grant for this app session. Discovery credentials exist only while enabled. */
export class ApiMcpService {
  private server?: Server;
  private connection?: ApiMcpStatus & { enabled: true };
  private runs = new Map<string, Run>();
  private changing = false;
  private confirming = false;
  private generation = 0;
  /** Aborted when the grant ends so queued work started through it cannot complete afterwards. */
  private grant?: AbortController;
  constructor(private workspace: ApiWorkspace, private discoveryFile?: string, private hooks: ApiMcpHooks = {}) {}
  status(): ApiMcpStatus { return this.connection ? { ...this.connection } : { enabled: false }; }

  async start(raw: unknown): Promise<ApiMcpStatus> {
    if (this.changing) throw new Error("MCP 연결을 변경하는 중입니다");
    this.changing = true;
    const generation = ++this.generation;
    try {
      const scope = connectionSchema.parse(raw);
      if (this.connection && this.connection.projectId !== scope.projectId) throw new Error("다른 프로젝트에서 사용 중인 MCP 연결을 먼저 끄세요");
      const project = (await this.workspace.listProjects()).find(p => p.id === scope.projectId);
      if (!project?.environments.some(e => e.id === scope.environmentId)) throw new Error("저장된 프로젝트와 환경을 선택하세요");
      if (generation !== this.generation) throw new Error("MCP 연결이 취소되었습니다");
      await this.close();
      const token = randomBytes(32).toString("hex");
      const server = createServer((req, res) => { void this.handle(req, res, token, scope).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
      server.requestTimeout = 15_000;
      server.headersTimeout = 10_000;
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      if (generation !== this.generation) { server.close(); throw new Error("MCP 연결이 취소되었습니다"); }
      this.server = server;
      const port = (server.address() as { port: number }).port;
      this.connection = { enabled: true, ...scope, url: `http://127.0.0.1:${port}/mcp`, token };
      this.grant = new AbortController();
      try {
        if (this.discoveryFile) {
          mkdirSync(path.dirname(this.discoveryFile), { recursive: true, mode: 0o700 });
          await releaseStaleDiscovery(this.discoveryFile, () => {
            if (generation !== this.generation) throw new Error("MCP 연결이 취소되었습니다");
          });
          if (generation !== this.generation) throw new Error("MCP 연결이 취소되었습니다");
          const temporary = `${this.discoveryFile}.${randomUUID()}.tmp`;
          writeFileSync(temporary, JSON.stringify({ url: this.connection.url, token, pid: process.pid }), { mode: 0o600, flag: "wx" });
          try { linkSync(temporary, this.discoveryFile); } finally { rmSync(temporary, { force: true }); }
        }
      } catch (error) { await this.close(); throw error; }
      return this.status();
    } finally { this.changing = false; }
  }
  async stop(): Promise<ApiMcpStatus> {
    this.generation++;
    return this.close();
  }
  private async close(): Promise<ApiMcpStatus> {
    const token = this.connection?.token;
    this.connection = undefined;
    this.grant?.abort();
    this.grant = undefined;
    if (this.discoveryFile && token) {
      try {
        if (JSON.parse(readFileSync(this.discoveryFile, "utf8")).token === token) rmSync(this.discoveryFile, { force: true });
      } catch { /* A removed/replaced discovery file must not prevent cancelling runs and closing sockets. */ }
    }
    for (const run of this.runs.values()) run.controller.abort();
    this.runs.clear();
    const server = this.server; this.server = undefined;
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    return this.status();
  }

  private async handle(req: IncomingMessage, res: ServerResponse, token: string, scope: ApiEnvironmentScope) {
    const deny = (status: number) => { res.writeHead(status); res.end(); };
    if (!this.connection || this.connection.token !== token) return deny(403);
    if (req.url !== "/mcp") return deny(404);
    // Reject browser cross-origin requests and DNS rebinding before parsing any body.
    if (req.headers.host !== new URL(this.connection.url).host || req.headers.origin) return deny(403);
    const actual = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return deny(401);
    if (req.method !== "POST") return deny(405);
    if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") return deny(415);
    let bytes = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 256_000) return deny(413);
      chunks.push(Buffer.from(chunk));
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return deny(400); }
    if (Array.isArray(body)) return deny(400);
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const mcp = await this.createMcp(scope, token);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  private async createMcp(scope: ApiEnvironmentScope, token: string) {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "checkly-api-testing", version: "1.0.0" }, {
      instructions: "Use get_context first. Only the user-enabled project/environment is accessible. Find APIs with list_apis (query/tag filters, up to 200 per call; serverId optional for a single server), then read only the needed ones with get_api_spec (apis: ['METHOD /path']). Reuse globals listed in get_context with their producer scenarios. Validate before saving. Run only when the user requests execution. Never invent credentials; use globals or supplied inputs. Stored scenarios use YAML: id, name, server, steps with name, api ('GET /path'), body/query/pathParams/headers, extract and expect. Step references: {{steps.1.response.body./id}}; globals: {{globals.token}}. No version or step id fields. Updates require the latest updatedAt. Before creating, check list_scenarios (query) for an existing scenario. delete_scenario asks the user in the app; never retry a declined delete. If a global a scenario needs has hasValue false, ask the user before running one of its producers first. run_scenario requires the projectId and environmentId from get_context. HTTP runs may change real data.",
    });
    const guard = () => { if (this.connection?.token !== token) throw new Error("MCP 연결이 종료되었습니다"); };
    const grant = this.connection?.token === token ? this.grant?.signal : undefined;
    if (!grant) throw new Error("MCP 연결이 종료되었습니다");
    const tool = (name: string, description: string, schema: z.ZodRawShape, readOnly: boolean, action: (args: any) => Promise<unknown>) => {
      server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true } }, async args => {
        try {
          guard();
          const result = await action(args);
          guard();
          const text = JSON.stringify(result);
          if (text.length > 240_000) throw new Error("결과가 큽니다. 조회 범위를 줄이세요");
          return { content: [{ type: "text" as const, text }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "요청 실패" }] };
        }
      });
    };
    tool("get_context", "허용된 프로젝트·환경·서버와 전역변수 이름/타입·값 존재 여부(hasValue), 그 전역변수를 만드는(extract)·쓰는 시나리오 이름 조회. 실제 변수 값은 반환하지 않습니다.", {}, true, async () => {
      const project = (await this.workspace.listProjects()).find(p => p.id === scope.projectId);
      if (!project) throw new Error("프로젝트를 찾을 수 없습니다");
      // Globals only extracted by a scenario have no stored entry yet; list them so the AI reuses the producer.
      // hasValue tells the AI to run a producer (with the user's OK) before scenarios that need it; values never leave the app.
      const globals = (await this.workspace.aiProjectSummary(scope.projectId)).globals.map(item => ({ ...item, hasValue: item.type !== undefined }));
      return { project: { id: project.id, name: project.name, servers: project.servers, environment: project.environments.find(e => e.id === scope.environmentId) }, globals };
    });
    /** serverId may be omitted when the project has a single server. */
    const resolveServer = async (serverId?: string) => {
      const servers = (await this.workspace.listProjects()).find(p => p.id === scope.projectId)?.servers ?? [];
      const server = serverId ? servers.find(item => item.id === serverId) : servers.length === 1 ? servers[0] : undefined;
      if (!server) throw new Error(serverId ? "서버를 찾을 수 없습니다. get_context의 servers[].id를 쓰세요" : `서버가 ${servers.length}개입니다. get_context의 servers[].id를 serverId로 지정하세요`);
      const catalog = await this.workspace.getCatalog({ ...scope, serverId: server.id });
      if (!catalog) throw new Error(`'${server.name}' 서버의 API 명세가 없습니다. 사용자에게 앱에서 API 명세를 가져오도록 요청하세요`);
      return { serverId: server.id, serverName: server.name, catalog };
    };
    const apiName = (operation: { method: string; path: string }) => `${operation.method.toUpperCase()} ${operation.path}`;
    const serverIdArg = z.string().uuid().optional().describe("서버가 하나면 생략");
    tool("list_apis", "API 목록(메서드·경로·태그·요약만). query는 경로·요약·태그에 대한 공백 구분 키워드(모두 포함), tag는 태그 정확히 일치. 상세 스키마는 get_api_spec으로 조회합니다.", { serverId: serverIdArg, query: z.string().max(200).optional(), tag: z.string().max(200).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(200) }, true, async ({ serverId, query, tag, offset, limit }) => {
      const server = await resolveServer(serverId);
      const words: string[] = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const operations = server.catalog.operations.filter(o => (!tag || o.tag === tag) && words.every(word => `${apiName(o)} ${o.summary} ${o.tag}`.toLowerCase().includes(word)));
      const page = operations.slice(offset, offset + limit);
      // Tags let the AI narrow a large spec without paging through every API.
      const counts = new Map<string, number>();
      if (!tag && !words.length) for (const o of server.catalog.operations) counts.set(o.tag, (counts.get(o.tag) ?? 0) + 1);
      const tags = counts.size ? [...counts].map(([name, count]) => ({ name, count })) : undefined;
      return { serverId: server.serverId, serverName: server.serverName, total: operations.length, offset, ...(offset + page.length < operations.length ? { nextOffset: offset + page.length } : {}), ...(tags ? { tags } : {}), apis: page.map(o => ({ api: apiName(o), tag: o.tag, summary: o.summary })) };
    });
    tool("get_api_spec", "지정한 API(최대 20개)의 파라미터·요청/응답 스키마·설명 조회. api 값은 list_apis의 'METHOD /path' 그대로 씁니다.", { serverId: serverIdArg, apis: z.array(z.string().min(1)).min(1).max(20) }, true, async ({ serverId, apis }) => {
      const server = await resolveServer(serverId);
      const wanted: string[] = apis.map((api: string) => api.trim().replace(/^(\S+)\s+/, (_, method: string) => `${method.toUpperCase()} `));
      const byName = new Map(server.catalog.operations.map(o => [apiName(o), o]));
      const operations = [...new Set(wanted)].flatMap(api => byName.get(api) ?? []);
      const notFound = wanted.filter(api => !byName.has(api));
      return { serverId: server.serverId, serverName: server.serverName, ...(notFound.length ? { notFound, hint: "list_apis의 api 값을 그대로 쓰세요" } : {}), apis: aiCatalogDetails([{ serverName: server.serverName, operations, spec: server.catalog.spec }])[0].apis };
    });
    tool("list_scenarios", "저장된 시나리오 목록. 본문 대신 설명·단계 수·사용 API·만드는 전역변수 요약을 줍니다. query는 이름·설명·API에 대한 공백 구분 키워드(모두 포함)로, 비슷한 시나리오가 이미 있는지 찾을 때 씁니다.", { query: z.string().max(200).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(30) }, true, async ({ query, offset, limit }) => {
      const words: string[] = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const items = (await this.workspace.listScenarios(scope.projectId)).map(scenarioSummary)
        .filter(item => words.every(word => [item.name, item.description ?? "", ...(item.apis ?? [])].join(" ").toLowerCase().includes(word)));
      return { total: items.length, offset, items: items.slice(offset, offset + limit) };
    });
    const findScenario = async (id: string) => {
      const item = (await this.workspace.listScenarios(scope.projectId)).find(s => s.id === id);
      if (!item) throw new Error("시나리오를 찾을 수 없습니다");
      return item;
    };
    tool("get_scenario", "시나리오 YAML과 수정 버전 조회. 저장된 본문에는 직접 입력한 값이 포함될 수 있습니다.", { id: z.string() }, true, async ({ id }) => findScenario(id));
    tool("validate_scenario", "YAML과 명세 연결 및 실행 준비 상태 검사. 저장/실행하지 않습니다.", sourceSchema, true, async ({ source, bindings }) => {
      let preview;
      // Syntax errors (bad YAML, forward step references) throw; report them like other issues instead of a tool error.
      try { preview = await this.workspace.previewScenario(scope, withGeneratedId(source), bindings); } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") return { valid: false, issues: [error.message], executionIssues: [] };
        throw error;
      }
      return { valid: !preview.issues.length, issues: preview.issues, executionIssues: preview.executionIssues ?? [] };
    });
    tool("save_scenario", "시나리오 생성/수정. 새 YAML에는 id 생략 가능. 수정은 id와 expectedUpdatedAt 필요. 실제 값 대신 globals/inputs를 사용하세요.", { ...sourceSchema, expectedUpdatedAt: z.string().optional() }, false, async ({ source, bindings, expectedUpdatedAt }) => {
      const item = await this.workspace.saveScenario(scope, withGeneratedId(source), bindings, expectedUpdatedAt, undefined, grant);
      return { id: item.id, name: item.name, updatedAt: item.updatedAt };
    });
    tool("delete_scenario", "시나리오 삭제. Checkly 앱에 사용자 확인 창이 뜨고, 사용자가 삭제를 누른 경우에만 지웁니다. 45초 안에 응답이 없거나 취소하면 지우지 않습니다. expectedUpdatedAt은 get_scenario·list_scenarios의 updatedAt입니다.", { id: z.string(), expectedUpdatedAt: z.string() }, false, async ({ id, expectedUpdatedAt }) => {
      if (!this.hooks.confirm) throw new Error("이 앱에서는 삭제 확인을 받을 수 없어 MCP로 삭제할 수 없습니다. 사용자에게 앱에서 직접 삭제하도록 안내하세요");
      if (this.confirming) throw new Error("다른 삭제 확인이 진행 중입니다. 사용자의 응답 후 다시 요청하세요");
      const item = await findScenario(id);
      if (item.updatedAt !== expectedUpdatedAt) throw new Error("그 사이 시나리오가 바뀌었습니다. get_scenario로 최신 내용을 확인한 뒤 다시 요청하세요");
      this.confirming = true;
      let approved: boolean;
      try {
        approved = await this.hooks.confirm({
          title: `시나리오 '${item.name}'을(를) 삭제할까요?`,
          detail: `외부 AI가 MCP로 삭제를 요청했습니다. 삭제하면 되돌릴 수 없습니다.${item.groupPath?.length ? `\n그룹: ${item.groupPath.join(" / ")}` : ""}`,
          signal: AbortSignal.any([grant, AbortSignal.timeout(CONFIRM_TIMEOUT_MS)]),
        });
      } finally { this.confirming = false; }
      guard();
      if (!approved) return { id, deleted: false, message: "사용자가 삭제하지 않았습니다(취소 또는 응답 시간 초과). 다시 요청하지 말고 사용자에게 확인하세요" };
      await this.workspace.deleteScenario(scope.projectId, id, expectedUpdatedAt);
      return { id, deleted: true };
    });
    tool("run_scenario", "저장된 시나리오를 현재 허용 환경에서 실행. projectId·environmentId는 get_context에서 확인한 값이며 현재 연결과 다르면 실행하지 않습니다. 실행 ID를 즉시 반환. 실제 API 데이터가 변경될 수 있습니다. 필요한 입력은 inputs로 제공하세요.", { id: z.string(), projectId: z.string().uuid(), environmentId: z.string().uuid(), inputs: z.record(z.string(), z.json()).default({}) }, false, async ({ id, projectId, environmentId, inputs }) => {
      // The stdio adapter follows the latest grant, so pin the run to the environment the AI was working against.
      if (projectId !== scope.projectId || environmentId !== scope.environmentId) throw new Error("MCP 연결의 프로젝트·환경이 바뀌었습니다. get_context로 현재 환경을 확인하고 사용자에게 실행 여부를 다시 확인하세요");
      if ([...this.runs.values()].some(r => r.state === "running")) throw new Error("MCP 테스트가 이미 실행 중입니다");
      const item = await findScenario(id); guard();
      if ([...this.runs.values()].some(r => r.state === "running")) throw new Error("MCP 테스트가 이미 실행 중입니다");
      if (item.draft) throw new Error("초안 시나리오는 실행할 수 없습니다");
      while (this.runs.size >= 30) this.runs.delete(this.runs.keys().next().value!);
      // The app shows MCP runs like its own, so the person can read the trace the AI never receives.
      const preview = await this.workspace.previewScenario(scope, item.source, item.bindings).catch(() => undefined); guard();
      const runId = randomUUID();
      const run: Run = { controller: new AbortController(), state: "running" };
      this.runs.set(runId, run);
      const startedAt = new Date().toISOString();
      void this.workspace.runScenario(scope, item.source, item.bindings, inputs, { runId, signal: run.controller.signal })
        .then(result => {
          run.state = result.status; run.result = summarize(result, parsedOrUndefined(item.source));
          if (preview) this.hooks.onRun?.({ ...scope, scenarioId: item.id, result, preview, bindings: item.bindings, startedAt, completedAt: new Date().toISOString() });
        })
        .catch(() => { run.state = run.controller.signal.aborted ? "cancelled" : "failed"; run.result = { message: "실행하지 못했습니다. validate_scenario로 명세·변수·입력을 확인하고, 앱에서 다른 실행이 진행 중인지 확인하세요." }; });
      return { runId, state: run.state };
    });
    tool("get_run", "실행 상태·단계별 상태·검증 요약 조회. checks[].label은 검증 내용(대상과 규칙)입니다. 요청/응답 본문, 헤더, 변수값은 외부로 보내지 않습니다.", { runId: z.string().uuid() }, true, async ({ runId }) => {
      const run = this.runs.get(runId); if (!run) throw new Error("실행 기록이 없거나 연결이 종료되었습니다");
      return { runId, state: run.state, result: run.result };
    });
    tool("cancel_run", "이 MCP 연결에서 시작한 실행 중지", { runId: z.string().uuid() }, false, async ({ runId }) => {
      const run = this.runs.get(runId); if (!run) throw new Error("실행 기록이 없습니다");
      run.controller.abort(); return { runId, requested: true };
    });
    return server;
  }
}

/** `label` words each check from the saved YAML (as the run report does); actual response values never leave the app. */
function summarize(result: ApiScenarioResult, scenario?: Scenario) {
  return { status: result.status, steps: result.steps.map(step => {
    const expectations = scenario?.steps.find(item => item.id === step.id)?.expect;
    return {
      id: step.id, name: step.name, status: step.status, httpStatus: step.httpStatus, durationMs: step.durationMs, failure: step.failure,
      checks: step.checks?.map(({ expect, passed }) => {
        const { target, rule } = describeCheck(expect === undefined ? undefined : expectations?.[expect], scenario);
        return { expect, ...(scenario ? { label: `${target} ${rule}` } : {}), passed };
      }),
    };
  }) };
}
function parsedOrUndefined(source: string): Scenario | undefined {
  try { return parseScenario(source); } catch { return undefined; }
}

/** What an AI needs to spot an existing scenario without fetching every YAML body. */
function scenarioSummary({ source, bindings, ...item }: SavedApiScenario) {
  try {
    const scenario = parseScenario(source);
    const globals = producedGlobalNames(scenario);
    return {
      ...item, ...(scenario.description ? { description: scenario.description } : {}), stepCount: scenario.steps.length,
      apis: [...new Set(scenario.steps.map(step => "method" in step.api ? `${step.api.method} ${step.api.path}` : step.api.operationId))],
      ...(globals.length ? { producesGlobals: globals } : {}),
    };
  } catch { return { ...item, description: undefined, apis: undefined, summaryError: "본문을 해석하지 못했습니다. get_scenario로 확인하세요" }; }
}
