import { z } from "zod";
import type { Json, Scenario, ScenarioInput, ScenarioInputRequest } from "./scenario";

export const httpUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash;
}, "인증정보를 제외한 HTTP(S) 주소를 입력하세요");
export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  servers: z.array(z.object({
    id: z.string().uuid(), name: z.string().trim().min(1).max(100),
  }).strict()).min(1),
  environments: z.array(z.object({
    id: z.string().uuid(), name: z.string().trim().min(1).max(100),
    baseUrls: z.record(z.string().uuid(), httpUrl.refine(v => !new URL(v).search, "기본 주소에 쿼리를 넣을 수 없습니다")),
  }).strict()).min(1),
  /** Local backend source folder the AI author may read. */
  backendPath: z.string().trim().min(1).max(4096).optional(),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.servers.map(server => server.name)).size !== p.servers.length)
    ctx.addIssue({ code: "custom", path: ["servers"], message: "프로젝트 내 서버 이름은 중복될 수 없습니다" });
  for (const group of [p.servers, p.environments]) {
    if (new Set(group.map(v => v.id)).size !== group.length)
      ctx.addIssue({ code: "custom", message: "중복 식별자" });
  }
  for (const e of p.environments) {
    if (p.servers.some(s => !e.baseUrls[s.id]) || Object.keys(e.baseUrls).some(id => !p.servers.some(s => s.id === id)))
      ctx.addIssue({ code: "custom", message: "모든 환경에 서버별 기본 주소가 필요합니다" });
  }
});
export type ApiProject = z.infer<typeof projectSchema>;
export const specSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file") }).strict(),
  z.object({ kind: z.literal("url"), url: httpUrl, remember: z.boolean().optional(), useSavedAuth: z.boolean().optional(), auth: z.object({
    kind: z.literal("basic"), username: z.string().min(1).max(1000).refine(v => !v.includes(":"), "아이디에 콜론은 사용할 수 없습니다"), password: z.string().max(1000),
  }).strict().optional() }).strict(),
]);
export type ApiSpecSource = z.infer<typeof specSourceSchema>;
export type ApiSpecSync = { url?: string; username?: string; hasSavedAccount: boolean; secureStorageAvailable: boolean; lastAttemptAt?: string; lastSuccessAt?: string; status?: "success" | "failed" };
export type ApiParameter = { name: string; location: string; required: boolean; description: string; type: string; style?: string; explode?: boolean; example?: Json };
export type ApiOperation = {
  tags?: string[];
  key: string; method: string; path: string; operationId?: string; summary: string; description: string; tag: string;
  parameters: ApiParameter[]; bodyRequired: boolean; bodyExample?: Json;
  bodySchema?: Json; responses: Json; warnings: string[];
};
export type ApiCatalog = { title: string; version: string; importedAt: string; spec?: Json; operations: ApiOperation[]; tags?: Array<{ name: string; description: string }> };
export type ApiRequestTrace = { method: string; url: string; headers: Record<string, string>; body?: Json };
export type ApiResponse = { status: string; httpStatus?: number; durationMs: number; request?: ApiRequestTrace; headers?: Record<string, string>; body?: Json; error?: string; failure?: { kind: "http" | "assertion" | "extraction" | "request" | "input" | "other"; source?: "status" | "header" | "body"; operator?: "exists" | "equals" | "contains" | "includes" }; input?: { name: string; provided: boolean }; inputs?: Array<{ name: string; provided: boolean }> };
export type ApiScope = { projectId: string; serverId: string; environmentId: string };
export type ApiProjectScope = Pick<ApiScope, "projectId">;
export type ApiEnvironmentScope = Pick<ApiScope, "projectId" | "environmentId">;
export type ApiGlobal = { name: string; type: string; displayValue: string };
/** Session cookie scope only; values never leave the main process. */
export type ApiCookie = { name: string; domain: string; path: string };
export type SavedApiScenario = { id: string; name: string; source: string; bindings: Record<string, string>; updatedAt: string; draft?: boolean; groupPath?: string[]; tags?: string[] };
export type SavedApiSuite = { id: string; name: string; scenarioIds: string[]; onFailure: "stop" | "continue"; updatedAt: string; groupPath?: string[]; tags?: string[] };
export type ApiSidebarMetadata = { groupPath?: string[]; tags?: string[] };
export type ApiScenarioPreview = { scenario: Scenario; issues: string[]; executionIssues?: string[] };
export type ApiScenarioResult = { status: string; steps: Array<ApiResponse & { id: string; name: string }>; variables: Record<string, Json> };
export type ApiScenarioInputRequest = ScenarioInputRequest & { requestId: string };
export type ApiScenarioInputSubmission = {
  requestId: string;
  runId: string;
  stepId: string;
  name: string;
  value: Json;
};
export type ApiAiCli = "claude" | "codex";
/** Detected (or configured) CLI; error explains why it cannot be used. */
export type ApiAiCliStatus = { cli: ApiAiCli; path?: string; version?: string; custom: boolean; error?: string };
/** App-wide (per machine) AI settings; an empty path means auto-detect. */
export type ApiAiSettings = { paths: Partial<Record<ApiAiCli, string>> };
export type ApiAiAuthorRequest = { scope: ApiEnvironmentScope; cli: ApiAiCli; model?: string; goal: string; includeSuite: boolean; tags?: string[] };
/** One AI-written scenario after Checkly's own checks; issues block saving it as a runnable scenario. */
export type ApiAiDraft = { id: string; name: string; yaml: string; stepCount: number; issues: string[]; executionIssues: string[] };
export type ApiAiAuthorResult = { drafts: ApiAiDraft[]; suite: { name: string; scenarioIds: string[]; problems: string[] } | null; notes: string; attempts: number };
export type ApiAiProgress = { phase: "writing" | "checking" | "repairing"; attempt: number; maxAttempts: number };
export type ApiTestingBridge = {
  getSpecSync(scope: ApiScope): Promise<ApiSpecSync>;
  deleteSpecAccount(scope: ApiScope): Promise<void>;
  getRequestAuth(scope: ApiScope): Promise<string | null>;
  setRequestAuth(scope: ApiScope, variable: string | null): Promise<void>;
  /** AI CLI detection results; refresh re-probes installs. Desktop app only. */
  listAiClis(refresh?: boolean): Promise<ApiAiCliStatus[]>;
  getAiSettings(): Promise<ApiAiSettings>;
  saveAiSettings(settings: ApiAiSettings): Promise<ApiAiCliStatus[]>;
  authorWithAi(request: ApiAiAuthorRequest): Promise<ApiAiAuthorResult>;
  getAiProgress(scope: ApiProjectScope): Promise<ApiAiProgress | null>;
  cancelAiAuthor(scope: ApiProjectScope): Promise<void>;
  copyAiPrompt(request: ApiAiAuthorRequest): Promise<void>;
  /** Native folder picker for the project's backend source; null when cancelled. */
  chooseDirectory(): Promise<string | null>;
  listProjects(): Promise<ApiProject[]>;
  saveProject(project: ApiProject): Promise<ApiProject>;
  deleteProject(projectId: string): Promise<void>;
  deleteCatalog(scope: ApiScope): Promise<void>;
  deleteScenario(projectId: string, id: string, expectedUpdatedAt: string): Promise<void>;
  getCatalog(scope: ApiScope): Promise<ApiCatalog | null>;
  importSpec(scope: ApiScope, source: ApiSpecSource): Promise<ApiCatalog | null>;
  /** Raw, transient response for the Swagger "Try it out". Never use for reports, persistence or AI context. */
  execute(scope: ApiScope, operationKey: string, request: Scenario["steps"][number]["request"]): Promise<ApiResponse>;
  cancel(scope: ApiScope): Promise<void>;
  listGlobals(scope: ApiProjectScope): Promise<ApiGlobal[]>;
  setGlobal(scope: ApiProjectScope, name: string, value: Json): Promise<void>;
  deleteGlobal(scope: ApiProjectScope, name: string): Promise<void>;
  listCookies(scope: ApiProjectScope): Promise<ApiCookie[]>;
  clearCookies(scope: ApiProjectScope): Promise<void>;
  listScenarios(projectId: string): Promise<SavedApiScenario[]>;
  listSuites(projectId: string): Promise<SavedApiSuite[]>;
  saveSuite(projectId: string, suite: Omit<SavedApiSuite, "updatedAt">, expectedUpdatedAt?: string): Promise<SavedApiSuite>;
  deleteSuite(projectId: string, id: string, expectedUpdatedAt: string): Promise<void>;
  saveSuiteReport(filename: string, html: string): Promise<string | null>;
  readScenarioFile(): Promise<string | null>;
  previewScenario(scope: ApiEnvironmentScope, source: string, bindings: Record<string, string>): Promise<ApiScenarioPreview>;
  saveScenario(scope: ApiEnvironmentScope, source: string, bindings: Record<string, string>, expectedUpdatedAt?: string, metadata?: ApiSidebarMetadata): Promise<SavedApiScenario>;
  saveScenarioDraft(scope: ApiEnvironmentScope, source: string, bindings: Record<string, string>, expectedUpdatedAt?: string, metadata?: ApiSidebarMetadata): Promise<SavedApiScenario>;
  runScenario(scope: ApiEnvironmentScope, source: string, bindings: Record<string, string>, inputs: Record<string, Json>): Promise<ApiScenarioResult>;
  getPendingScenarioInput(scope: ApiEnvironmentScope): Promise<ApiScenarioInputRequest | null>;
  submitScenarioInput(scope: ApiEnvironmentScope, submission: ApiScenarioInputSubmission): Promise<void>;
};
