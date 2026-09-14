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
}).strict().superRefine((p, ctx) => {
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
export type ApiParameter = { name: string; location: string; required: boolean; description: string; type: string; example?: Json };
export type ApiOperation = {
  tags?: string[];
  key: string; method: string; path: string; operationId?: string; summary: string; description: string; tag: string;
  parameters: ApiParameter[]; bodyRequired: boolean; bodyExample?: Json;
  bodySchema?: Json; responses: Json; warnings: string[];
};
export type ApiCatalog = { title: string; version: string; importedAt: string; spec?: Json; operations: ApiOperation[]; tags?: Array<{ name: string; description: string }> };
export type ApiResponse = { status: string; httpStatus?: number; durationMs: number; headers?: Record<string, string>; body?: Json; error?: string; input?: { name: string; provided: boolean } };
export type ApiScope = { projectId: string; serverId: string; environmentId: string };
export type ApiEnvironmentScope = Pick<ApiScope, "projectId" | "environmentId">;
export type ApiGlobal = { name: string; type: string; displayValue: string };
export type SavedApiScenario = { id: string; name: string; source: string; bindings: Record<string, string>; updatedAt: string; draft?: boolean };
export type ApiScenarioPreview = { scenario: Scenario; issues: string[] };
export type ApiScenarioResult = { status: string; steps: Array<ApiResponse & { id: string; name: string }>; variables: Record<string, Json> };
export type ApiScenarioInputRequest = ScenarioInputRequest & { requestId: string };
export type ApiScenarioInputSubmission = {
  requestId: string;
  runId: string;
  stepId: string;
  name: string;
  value: Json;
};
export type ApiAiContextRequest = { scope: ApiEnvironmentScope; selections: Array<{ serverId: string; operationKey: string }>; goal: string };
export type ApiTestingBridge = {
  getSpecSync(scope: ApiScope): Promise<ApiSpecSync>;
  deleteSpecAccount(scope: ApiScope): Promise<void>;
  getRequestAuth(scope: ApiScope): Promise<string | null>;
  setRequestAuth(scope: ApiScope, variable: string | null): Promise<void>;
  buildAiContext(request: ApiAiContextRequest): Promise<string>;
  copyAiContext(request: ApiAiContextRequest): Promise<void>;
  listProjects(): Promise<ApiProject[]>;
  saveProject(project: ApiProject): Promise<ApiProject>;
  deleteProject(projectId: string): Promise<void>;
  deleteCatalog(scope: ApiScope): Promise<void>;
  deleteScenario(projectId: string, id: string, expectedUpdatedAt: string): Promise<void>;
  getCatalog(scope: ApiScope): Promise<ApiCatalog | null>;
  importSpec(scope: ApiScope, source: ApiSpecSource): Promise<ApiCatalog | null>;
  execute(scope: ApiScope, operationKey: string, request: Scenario["steps"][number]["request"]): Promise<ApiResponse>;
  /** Unredacted, transient interactive response. Never use for reports, persistence or AI context. */
  executeLive(scope: ApiScope, operationKey: string, request: Scenario["steps"][number]["request"]): Promise<ApiResponse>;
  cancel(scope: ApiScope): Promise<void>;
  listGlobals(scope: ApiEnvironmentScope): Promise<ApiGlobal[]>;
  setGlobal(scope: ApiEnvironmentScope, name: string, value: Json): Promise<void>;
  deleteGlobal(scope: ApiEnvironmentScope, name: string): Promise<void>;
  listScenarios(projectId: string): Promise<SavedApiScenario[]>;
  readScenarioFile(): Promise<string | null>;
  previewScenario(scope: ApiEnvironmentScope, source: string, bindings: Record<string, string>): Promise<ApiScenarioPreview>;
  saveScenario(scope: ApiEnvironmentScope, source: string, bindings: Record<string, string>, expectedUpdatedAt?: string): Promise<SavedApiScenario>;
  saveScenarioDraft(scope: ApiEnvironmentScope, source: string, bindings: Record<string, string>, expectedUpdatedAt?: string): Promise<SavedApiScenario>;
  runScenario(scope: ApiEnvironmentScope, source: string, bindings: Record<string, string>, inputs: Record<string, Json>): Promise<ApiScenarioResult>;
  getPendingScenarioInput(scope: ApiEnvironmentScope): Promise<ApiScenarioInputRequest | null>;
  submitScenarioInput(scope: ApiEnvironmentScope, submission: ApiScenarioInputSubmission): Promise<void>;
};
