import { z } from "zod";
import type { Json, Scenario, ScenarioInputRequest } from "./scenario";
import type { ApiDocInput } from "./doc-inputs";
export type { ApiDocInput } from "./doc-inputs";

export const httpUrl = z.string().url("http:// 또는 https://로 시작하는 주소를 입력하세요").refine((value) => {
  // Runs even when the URL check failed: never let `new URL` throw its English "Invalid URL".
  let url: URL;
  try { url = new URL(value); } catch { return false; }
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
/** `titleChanges`: per operation key, earlier summaries (still possibly used as step names) and the current one. */
export type ApiCatalog = { title: string; version: string; importedAt: string; spec?: Json; operations: ApiOperation[]; tags?: Array<{ name: string; description: string }>; titleChanges?: Record<string, { from: string[]; to: string }> };
export type ApiRequestTrace = { method: string; url: string; headers: Record<string, string>; body?: Json };
/** One response check of a step: `expect` indexes step.expect, absent = automatic 2xx; `actual` only on failure. */
export type ApiCheckResult = { expect?: number; passed: boolean; actual?: string };
export type ApiResponse = { status: string; httpStatus?: number; durationMs: number; checks?: ApiCheckResult[]; request?: ApiRequestTrace; headers?: Record<string, string>; body?: Json; error?: string; failure?: { kind: "http" | "assertion" | "extraction" | "request" | "input" | "other"; source?: "status" | "header" | "body"; operator?: "exists" | "equals" | "contains" | "includes" }; input?: { name: string; provided: boolean }; inputs?: Array<{ name: string; provided: boolean }> };
export type ApiScope = { projectId: string; serverId: string; environmentId: string };
export type ApiProjectScope = Pick<ApiScope, "projectId">;
export type ApiEnvironmentScope = Pick<ApiScope, "projectId" | "environmentId">;
export type ApiGlobal = { name: string; type: string; displayValue: string };
/** Session cookie scope only; values never leave the main process. */
export type ApiCookie = { name: string; domain: string; path: string };
export type SavedApiScenario = { id: string; name: string; source: string; bindings: Record<string, string>; updatedAt: string; draft?: boolean; groupPath?: string[]; tags?: string[]; /** Old-title → new-title renames the user chose to keep as is. */ keptTitles?: Array<{ from: string; to: string }> };
/**
 * A project shared as one file: settings, scenarios and suites, plus each spec's URL, as written.
 * Never carries globals, saved docs accounts, cookies, remembered docs inputs or spec bodies.
 */
export type ApiProjectExport = {
  format: "checkly-api-project"; version: 1; exportedAt: string;
  /** Id of the project this one was first shared from (its own id for the original). */
  origin: string;
  /** Content hashes of the version the sender last received/merged, to tell who changed what. */
  base: { scenarios: Record<string, string>; suites: Record<string, string> };
  project: ApiProject;
  specUrls: Array<{ serverId: string; environmentId: string; url: string }>;
  scenarios: Array<{ id: string; name: string; source: string; draft?: boolean; groupPath?: string[]; tags?: string[] }>;
  suites: Array<{ id: string; name: string; scenarioIds: string[]; onFailure: "stop" | "continue"; groupPath?: string[]; tags?: string[] }>;
};
export type ApiProjectImportResult = {
  project: ApiProject; scenarios: number; suites: number; specUrls: number;
  /** Set when merged into an existing copy: what came from the file and what stayed local. */
  merged?: { added: number; updated: number; kept: number };
};
/**
 * Scenario/suite changes against the last version both sides had (the "base"): `incoming` changed
 * only in the file and is applied, `mine` changed only locally and is kept, `conflicts` changed on
 * both sides (or have no base yet) and need a choice.
 */
export type ApiShareDiff = { added: Array<{ id: string; name: string }>; incoming: Array<{ id: string; name: string }>; conflicts: Array<{ id: string; name: string }>; mine: number; same: number };
export type ApiProjectImportPlan = {
  name: string; scenarios: number; suites: number;
  /** Local copies of the same project that the file can update. */
  targets: Array<{ projectId: string; name: string; scenarios: ApiShareDiff; suites: ApiShareDiff; serversAdded: string[]; environmentsAdded: string[] }>;
};
export type SavedApiSuite = { id: string; name: string; scenarioIds: string[]; onFailure: "stop" | "continue"; updatedAt: string; groupPath?: string[]; tags?: string[] };
export type ApiSidebarMetadata = { groupPath?: string[]; tags?: string[] };
export type ApiScenarioPreview = { scenario: Scenario; issues: string[]; executionIssues?: string[] };
/** A saved scenario with steps whose API is gone from the current specs; steps read "label (METHOD path)". */
export type ApiMissingApi = { scenarioId: string; scenario: string; steps: string[] };
/** A saved scenario with steps still named after an API title the spec has since changed. */
export type ApiTitleRename = { scenarioId: string; scenario: string; steps: Array<{ from: string; to: string }> };
export type ApiSpecImpact = { missing: ApiMissingApi[]; renamed: ApiTitleRename[] };
export type ApiScenarioResult = { status: string; steps: Array<ApiResponse & { id: string; name: string }>; variables: Record<string, Json> };
export type ApiScenarioInputRequest = ScenarioInputRequest & { requestId: string };
export type ApiScenarioInputSubmission = {
  requestId: string;
  runId: string;
  stepId: string;
  name: string;
  value: Json;
};
/** Guide for the user's own AI; tags or picked operations ("<serverId> <METHOD path>") narrow the APIs it may use. */
export type ApiAiGuideRequest = { scope: ApiEnvironmentScope; tags?: string[]; operations?: string[] };
/**
 * issues keep a draft from running; notices are warnings only. sameName: a saved scenario already has
 * this name (often the same result loaded again), so it starts unchosen.
 */
export type ApiAiDraft = { id: string; name: string; yaml: string; stepCount: number; issues: string[]; notices: string[]; executionIssues: string[]; groupPath?: string[]; sameName?: true; /** The saved scenario (same name, the only one) this draft updates when saved as is. */ replaces?: string };
export type ApiAiImportResult = { drafts: ApiAiDraft[]; suite: { name: string; scenarioIds: string[]; problems: string[]; groupPath?: string[]; /** Already-saved scenarios the suite reuses, by id. */ saved?: Record<string, string>; /** Same-name draft id → the saved scenario used when that draft is not saved. */ fallbacks?: Record<string, string>; /** The one saved suite with the same name: saving updates it instead of adding a copy. */ replaces?: { id: string; updatedAt: string; onFailure: "stop" | "continue" } } | null };
/** Backend source folders on this PC per server id (absolute paths). Kept out of the shareable project. */
export type ApiBackendFolders = Record<string, string[]>;
export type ApiAiTool = "claude" | "codex";
/** How hard the AI thinks: lower answers faster. Both CLIs accept these; unset uses the CLI default. */
/** In-app chat settings of a project on this PC: backend folders per server and which AI CLI (model and effort are the CLI defaults). */
export type ApiAiChatSettings = { folders: ApiBackendFolders; tool?: ApiAiTool };
/** AI CLIs installed on this PC; empty (with why) when there is none or in the web dev mode. */
export type ApiAiChatStatus = { tools: Array<{ tool: ApiAiTool; version: string }>; error?: string };
/** The project's in-app AI terminal: which CLI, in which environment, whether it runs, and recent output to replay. */
export type ApiAiTerminal = {
  tool: ApiAiTool; environmentId: string; running: boolean; buffer: string;
  /** The result (by its save time) the user already saved from, with the first saved scenario; kept while the app runs. */
  saved?: { modifiedAt: string; scenarioId?: string };
};
export type ApiAiTerminalEvent =
  | { type: "data"; projectId: string; data: string }
  | { type: "exit"; projectId: string; exitCode: number }
  /** The AI saved its result file; the screen checks it. */
  | { type: "result"; projectId: string };
/** 바로 만들기: the AI writes from one request without a conversation; only its progress and last answer are shown. */
export type ApiAiQuick = {
  tool: ApiAiTool; environmentId: string;
  status: "running" | "done" | "failed" | "stopped";
  /** The requests so far, the first one and each 수정 요청. */
  requests: string[];
  /** What the AI is doing now, e.g. "읽는 중: UserController.java". */
  progress: string;
  /** The AI's last answer: what it made and what it decided on its own. */
  note: string;
  /** Automatic fixes of Checkly's problems used for the latest request. */
  fixes: number;
  error?: string;
  /** The checked result file (absent until the AI saves it). */
  check?: { modifiedAt: string; result: ApiAiImportResult };
  saved?: { modifiedAt: string; scenarioId?: string };
};
export type ApiAiQuickEvent = { projectId: string; quick: ApiAiQuick | null };
/**
 * fix: AI로 고치기 from a failed run. Only the saved YAML, where it failed (step, HTTP status) and, when the user
 * allows it, the start of that step's response go to the AI; request is the user's optional message then.
 */
export type ApiAiQuickRequest = { scope: ApiEnvironmentScope; request: string; fix?: { scenarioId: string; failures: string[]; response?: string } };
export type ApiAiTerminalStartRequest = { scope: ApiEnvironmentScope; size: { cols: number; rows: number } };
/** checkly: messages Checkly adds (guide sent, check results); `result` is a checked AI answer to review and save. */
export type ApiTestingBridge = {
  /** Which AI CLIs are installed and the project's chat settings (desktop app only). */
  getAiChatStatus(refresh?: boolean): Promise<ApiAiChatStatus>;
  getAiChatSettings(projectId: string): Promise<ApiAiChatSettings>;
  saveAiChatSettings(projectId: string, settings: ApiAiChatSettings): Promise<ApiAiChatSettings>;
  /** Native picker allowing several folders; empty when cancelled. */
  chooseDirectories(): Promise<string[]>;
  /** In-app AI terminal (desktop app only). */
  getAiTerminal(projectId: string): Promise<ApiAiTerminal | null>;
  startAiTerminal(request: ApiAiTerminalStartRequest): Promise<ApiAiTerminal>;
  /** Reopens the saved session (after a restart or after the CLI exited). */
  resumeAiTerminal(request: ApiAiTerminalStartRequest): Promise<ApiAiTerminal>;
  writeAiTerminal(projectId: string, data: string): void;
  resizeAiTerminal(projectId: string, size: { cols: number; rows: number }): void;
  /** Ends the session (stops the CLI, forgets the session and the last result). */
  clearAiTerminal(projectId: string): Promise<void>;
  /** Checks the terminal session's result file; null until the AI writes it. */
  checkAiTerminalResult(scope: ApiEnvironmentScope): Promise<{ modifiedAt: string; result: ApiAiImportResult } | null>;
  /** Remembers that the user saved from this result, so reopening the panel shows it as saved. */
  markAiTerminalResultSaved(projectId: string, saved: { modifiedAt: string; scenarioId?: string }): Promise<void>;
  /** Rewrites the project state the AI reads (after saving scenarios). */
  refreshAiTerminalFiles(scope: ApiEnvironmentScope): Promise<void>;
  /** Terminal output, exits and result saves of every project; returns the unsubscribe. */
  onAiTerminalEvent(listener: (event: ApiAiTerminalEvent) => void): () => void;
  /** 바로 만들기 of the project (in memory only; gone after a restart). */
  getAiQuick(projectId: string): Promise<ApiAiQuick | null>;
  /** Starts a new 바로 만들기 from a request (replaces the previous one). */
  startAiQuick(request: ApiAiQuickRequest): Promise<ApiAiQuick>;
  /** 수정 요청 in the same AI session. */
  reviseAiQuick(projectId: string, request: string): Promise<ApiAiQuick>;
  stopAiQuick(projectId: string): Promise<void>;
  clearAiQuick(projectId: string): Promise<void>;
  markAiQuickResultSaved(projectId: string, saved: { modifiedAt: string; scenarioId?: string }): Promise<void>;
  onAiQuickEvent(listener: (event: ApiAiQuickEvent) => void): () => void;
  getSpecSync(scope: ApiScope): Promise<ApiSpecSync>;
  deleteSpecAccount(scope: ApiScope): Promise<void>;
  getRequestAuth(scope: ApiScope): Promise<string | null>;
  setRequestAuth(scope: ApiScope, variable: string | null): Promise<void>;
  /** Copies the authoring guide for the user's own AI (Claude Code, Codex…). */
  copyAiPrompt(request: ApiAiGuideRequest): Promise<void>;
  /** Same guide text, for reading it in the app. */
  getAiPrompt(request: ApiAiGuideRequest): Promise<string>;
  /** The result file the user's AI wrote; null when it does not exist yet. */
  readAiResult(scope: ApiEnvironmentScope): Promise<{ path: string; text: string; modifiedAt: string } | null>;
  /** Checks pasted AI output (scenarios separated by ---, optional suite); nothing is saved. */
  checkAiScenarios(scope: ApiEnvironmentScope, text: string): Promise<ApiAiImportResult>;
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
  /** Last "Try it out" values per operation key of the scope's server; secrets are never kept. */
  getDocInputs(scope: ApiScope): Promise<Record<string, ApiDocInput>>;
  forgetDocInput(scope: ApiScope, operationKey: string): Promise<void>;
  /** Saves the project as a share file; resolves to where it was saved, or null when cancelled. */
  exportProject(projectId: string): Promise<string | null>;
  /** Picks a share file; resolves to its text, or null when cancelled. */
  readProjectFile(): Promise<string | null>;
  planProjectImport(text: string): Promise<ApiProjectImportPlan>;
  /** New project without `update`; with it, merges into that copy taking the file side for the listed conflicts. */
  importProject(text: string, update?: { projectId: string; scenarioIds: string[]; suiteIds: string[] }): Promise<ApiProjectImportResult>;
  listGlobals(scope: ApiProjectScope): Promise<ApiGlobal[]>;
  setGlobal(scope: ApiProjectScope, name: string, value: Json): Promise<void>;
  deleteGlobal(scope: ApiProjectScope, name: string): Promise<void>;
  listCookies(scope: ApiProjectScope): Promise<ApiCookie[]>;
  clearCookies(scope: ApiProjectScope): Promise<void>;
  listScenarios(projectId: string): Promise<SavedApiScenario[]>;
  checkScenarioSpecs(scope: ApiEnvironmentScope): Promise<ApiSpecImpact>;
  applyTitleRenames(scope: ApiEnvironmentScope): Promise<{ updated: string[]; skipped: string[] }>;
  keepTitles(scope: ApiEnvironmentScope, scenarioId: string): Promise<void>;
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
