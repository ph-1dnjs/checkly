import { constants, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { httpUrl, projectSchema, teamProjectSchema, type ApiStorageInfo, type ApiCatalog, type ApiCookie, type ApiProject, type ApiScope, type ApiResponse, type ApiProjectScope, type ApiEnvironmentScope, type ApiGlobal, type SavedApiScenario, type SavedApiSuite, type ApiSidebarMetadata, type ApiScenarioPreview, type ApiScenarioResult, type ApiRequestTrace, type ApiAiImportResult, type ApiAiDraft, type ApiMissingApi, type ApiTitleRename, type ApiSpecImpact, type ApiProjectExport, type ApiProjectImportResult, type ApiProjectImportPlan, type ApiShareDiff } from "../shared/workspace";
import { z } from "zod";
import { ApiRunner, resolveRequestUrl } from "./execution";
import { resolve } from "./variables";
import { docInputFromRequest, type ApiDocInput } from "../shared/doc-inputs";
import { bindingUseLocations, pruneUnusedBrokenBindings, stringifyScenario, parseScenario, ScenarioFormatError, scenarioSchema, scenarioStepInputs, scenarioStepLabel, type Json, type Scenario, type ScenarioInputRequest } from "../shared/scenario";
import { readOpenApi } from "./openapi";
import { CookieJar } from "./cookies";
import { groupMissingGlobals, stepNumbersText } from "../shared/preflight-issues";
import { aiCatalogDetails, createAuthorPrompt, splitAiBundle, withGeneratedId, type AiBundle } from "./ai-context";
import { FileStore, type ApiStore, type ScenarioRename } from "./store";
import { TeamStore, type ApiTeamContext } from "./team-store";

export const scopeSchema = z.object({ projectId: z.string().uuid(), serverId: z.string().uuid(), environmentId: z.string().uuid() }).strict();
const projectScopeSchema = z.object({ projectId: z.string().uuid() }).strict();
const environmentScopeSchema = scopeSchema.partial({ serverId: true });
const variableName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).refine(v => !["constructor", "prototype"].includes(v));
const bindingSchema = z.record(z.string(), z.string().uuid());
const sidebarMetadataSchema = z.object({
  groupPath: z.array(z.string().trim().min(1).max(80).refine(segment => !segment.includes("/"), "폴더 이름에는 /를 사용할 수 없습니다")).max(10).optional().refine(value => !value || value.join("/").length <= 200, "그룹 경로는 200자 이하로 입력하세요").transform(value => value?.length ? value : undefined),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional().transform(values => values?.length ? [...new Map(values.map(value => [value.toLocaleLowerCase(), value])).values()] : undefined),
}).strict();
const suiteSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(100), scenarioIds: z.array(z.string().min(1).max(1000)).min(1).max(100), onFailure: z.enum(["stop", "continue"]) }).extend(sidebarMetadataSchema.shape).strict();
type ShareBase = { scenarios: Record<string, string>; suites: Record<string, string> };
const shareHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
// Folder and tags are part of what is shared, so a change to only them still counts.
type ShareMetadata = { groupPath?: string[]; tags?: string[] };
const scenarioShareHash = (item: { source: string; draft?: boolean } & ShareMetadata) => shareHash([item.source, Boolean(item.draft), item.groupPath ?? [], item.tags ?? []]);
const suiteShareHash = (suite: { name: string; onFailure: string; scenarioIds: string[] } & ShareMetadata) => shareHash([suite.name, suite.onFailure, suite.scenarioIds, suite.groupPath ?? [], suite.tags ?? []]);
/**
 * Three-way: what changed since the last version both sides had (`base`, from the file). `seen` is
 * the version this side last took in: a file version already merged once keeps the local choice.
 */
function shareChange(file: string, local: string, base: string | undefined, seen?: string): "same" | "incoming" | "mine" | "conflict" {
  if (file === local) return "same";
  if (file === seen) return "mine";
  if (base === undefined) return "conflict";
  if (local === base) return "incoming";
  return file === base ? "mine" : "conflict";
}
const keptTitle = (item: SavedApiScenario, from: string, to: string) => Boolean(item.keptTitles?.some(kept => kept.from === from && kept.to === to));
function migrateSidebarMetadata<T extends Record<string, unknown>>(item: T): T & Partial<ApiSidebarMetadata> {
  const { group: legacyGroup, ...rest } = item;
  const rawPath = Array.isArray(item.groupPath)
    ? item.groupPath
    : typeof legacyGroup === "string" ? legacyGroup.split("/") : undefined;
  const metadata = sidebarMetadataSchema.parse({
    ...(rawPath !== undefined ? { groupPath: rawPath } : {}),
    ...(Array.isArray(item.tags) ? { tags: item.tags } : {}),
  });
  return { ...rest, ...metadata } as T & Partial<ApiSidebarMetadata>;
}
const aiGuideRequestSchema = z.object({
  scope: environmentScopeSchema, tags: z.array(z.string().max(200)).max(100).optional(),
  operations: z.array(z.string().max(400)).max(2000).optional(),
}).strict();
/** "회원/인증" → ["회원", "인증"], checked with the same rules as the sidebar folders. */
function aiGroupPath(group?: string): { path?: string[]; error?: string } {
  if (!group) return {};
  const parsed = sidebarMetadataSchema.safeParse({ groupPath: group.split("/").map(part => part.trim()).filter(Boolean) });
  return parsed.success ? { path: parsed.data.groupPath } : { error: `그룹 '${group}'을 쓸 수 없습니다: ${parsed.error.issues[0]?.message ?? "형식 오류"}` };
}
export type ApiScenarioRunOptions = {
  runId?: string;
  requestInput?: (request: ScenarioInputRequest) => Promise<Json | undefined>;
};

export class ApiWorkspace {
  private queue: Promise<unknown> = Promise.resolve();
  private runner = new ApiRunner();
  private active = new Map<string, AbortController>();
  private requestAuth = new Map<string, { variable: string; baseUrl: string }>();
  /** This computer's files: every project without sign-in, and the local caches (specs, AI files) in team mode. */
  private files: FileStore;
  private team?: { key: string; store: TeamStore };
  /** `teamContext`: the signed-in team project, or null to keep everything in `directory` (as before sign-in existed). */
  constructor(private directory: string, private teamContext: () => ApiTeamContext | null = () => null) {
    this.files = new FileStore(directory);
  }
  /** The team project's store while signed in, else null. A different sign-in drops what the last one left in memory. */
  private teamStore(): TeamStore | null {
    const context = this.teamContext();
    const key = context ? `${context.userId}:${context.projectId}` : "";
    if ((this.team?.key ?? "") !== key) {
      const previous = this.team?.store.context.projectId;
      if (previous) { this.runner.globals.clear(previous); this.cookieJars.delete(previous); }
      this.requestAuth.clear(); this.catalogCache.clear();
      this.team = context ? { key, store: new TeamStore(context) } : undefined;
    }
    return this.team?.store ?? null;
  }
  private store(): ApiStore { return this.teamStore() ?? this.files; }
  /** Call when the sign-in changes, so its in-memory state goes now rather than on the next request. */
  syncSession() { this.teamStore(); }
  /** Internal reads may reuse a team project read a moment ago; files are always read again. */
  private projects() { return this.store().listProjects(3_000); }
  private async requireProject(projectId: string) {
    if (!(await this.projects()).some(project => project.id === projectId)) throw new Error("프로젝트를 찾을 수 없습니다");
  }
  private maintenance = new Set<string>();
  private syncing = new Map<string, number>();
  private catalogCache = new Map<string, ApiCatalog | null>();
  // Session cookies are shared by every run in a project, like globals, and never persisted.
  private cookieJars = new Map<string, CookieJar>();
  private cookieJar(projectId: string): CookieJar {
    let jar = this.cookieJars.get(projectId);
    if (!jar) { jar = new CookieJar(); this.cookieJars.set(projectId, jar); }
    return jar;
  }
  beginSpecSync(input: ApiScope) {
    const { projectId } = scopeSchema.parse(input);
    this.assertAvailable(projectId);
    this.syncing.set(projectId, (this.syncing.get(projectId) ?? 0) + 1);
    return () => { const count = (this.syncing.get(projectId) ?? 1) - 1; if (count) this.syncing.set(projectId, count); else this.syncing.delete(projectId); };
  }
  private assertAvailable(projectId: string) {
    if (this.maintenance.has(projectId)) throw new Error("프로젝트 변경 중입니다. 잠시 후 다시 시도하세요");
  }
  private async mutate<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      if (this.syncing.has(projectId) || [...this.active.keys()].some(k => k.startsWith(`${projectId}:`))) throw new Error("실행·명세 동기화 중에는 삭제하거나 설정을 변경할 수 없습니다");
      this.maintenance.add(projectId);
      try { return await action(); } finally { this.maintenance.delete(projectId); }
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private async clearScope(scope: ApiScope) {
    await this.files.remove(this.filename(scope));
    await this.files.remove(`spec-source-${scope.projectId}-${scope.environmentId}-${scope.serverId}.json`);
    this.requestAuth.delete(this.authKey(scope));
    this.catalogCache.delete(this.filename(scope));
  }
  async deleteProject(rawId: string): Promise<void> {
    const id = z.string().uuid().parse(rawId);
    if (this.teamStore()) throw new Error("팀 프로젝트는 API 테스트에서 삭제할 수 없습니다");
    return this.mutate(id, async () => {
      const projects = await this.files.listProjects();
      const project = projects.find(p => p.id === id);
      if (!project) throw new Error("프로젝트를 찾을 수 없습니다");
      for (const env of project.environments) {
        for (const server of project.servers) await this.clearScope({ projectId: id, environmentId: env.id, serverId: server.id });
      }
      this.runner.globals.clear(id);
      this.cookieJars.delete(id);
      await this.files.remove(`scenarios-${id}.json`);
      await this.files.remove(`suites-${id}.json`);
      await this.files.remove(`doc-inputs-${id}.json`);
      const origins = await this.readShareOrigins(), bases = await this.readShareBases();
      delete origins[id]; delete bases[id];
      await this.files.save("share-origins.json", origins); await this.files.save("share-bases.json", bases);
      await rm(this.aiFiles(id).dir, { recursive: true, force: true });
      // Leftovers the steps above do not name: old format backups (…-<id>.json.bak-…) and specs of
      // server/environment pairs no longer in the project. The id is a UUID, so this matches only it.
      for (const file of await readdir(this.directory).catch(() => [] as string[])) {
        if (file.includes(`-${id}.`) || file.includes(`-${id}-`)) await this.files.remove(file);
      }
      await this.files.save("projects.json", projects.filter(p => p.id !== id));
    });
  }
  /** Local project id → id of the project it was first shared from (absent for the original). */
  private async readShareOrigins(): Promise<Record<string, string>> {
    const parsed = z.record(z.string().uuid(), z.string().uuid()).safeParse(await this.files.read("share-origins.json"));
    return parsed.success ? parsed.data : {};
  }

  /**
   * Share file text for a project (see ApiProjectExport). Scenarios and spec URLs go as written,
   * so secrets belong in globals, which stay local like saved docs accounts and cookies.
   */
  async exportProject(rawProjectId: string): Promise<string> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const project = (await this.projects()).find(p => p.id === projectId);
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다");
    const specUrls: ApiProjectExport["specUrls"] = await this.store().specUrls(project);
    const data: ApiProjectExport = {
      format: "checkly-api-project", version: 1, exportedAt: new Date().toISOString(),
      origin: (await this.readShareOrigins())[projectId] ?? projectId,
      base: (await this.readShareBases())[projectId] ?? { scenarios: {}, suites: {} }, project, specUrls,
      scenarios: (await this.listScenarios(projectId)).map(item => ({ id: item.id, name: item.name, source: item.source, ...(item.draft ? { draft: true } : {}), ...(item.groupPath ? { groupPath: item.groupPath } : {}), ...(item.tags ? { tags: item.tags } : {}) })),
      suites: (await this.listSuites(projectId)).map(({ updatedAt: _updatedAt, ...suite }) => suite),
    };
    return JSON.stringify(data, null, 2);
  }

  private async specUrl(projectId: string, environmentId: string, serverId: string): Promise<string | undefined> {
    const stored = await this.files.read(`spec-source-${projectId}-${environmentId}-${serverId}.json`) as { url?: unknown } | null;
    return typeof stored?.url === "string" ? stored.url : undefined;
  }

  private parseShareFile(text: string) {
    if (text.length > 10_000_000) throw new Error("프로젝트 파일은 10MB 이하만 지원합니다");
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error("Checkly 프로젝트 파일이 아닙니다"); }
    const parsed = z.object({
      format: z.literal("checkly-api-project"), version: z.literal(1), exportedAt: z.string().optional(),
      origin: z.string().uuid().optional(),
      base: z.object({ scenarios: z.record(z.string(), z.string()), suites: z.record(z.string(), z.string()) }).strict().optional(),
      project: projectSchema,
      specUrls: z.array(z.object({ serverId: z.string().uuid(), environmentId: z.string().uuid(), url: httpUrl }).strict()).max(1000),
      scenarios: z.array(z.object({ id: z.string().min(1).max(1000), name: z.string().max(200), source: z.string().max(1_000_000), draft: z.boolean().optional() }).extend(sidebarMetadataSchema.shape).strict()).max(5000),
      suites: z.array(suiteSchema).max(1000),
    }).strict().safeParse(raw);
    if (!parsed.success) throw new Error(raw && typeof raw === "object" && (raw as { format?: unknown }).format === "checkly-api-project" ? "지원하지 않는 프로젝트 파일 형식입니다" : "Checkly 프로젝트 파일이 아닙니다");
    const data = parsed.data;
    // Scenarios keep their YAML ids (suites point at them) and must still be valid YAML.
    for (const item of data.scenarios) {
      if (this.parseSource(item.source).id !== item.id) throw new Error(`시나리오 '${item.name}'의 ID가 파일 내용과 다릅니다`);
    }
    if (new Set(data.scenarios.map(item => item.id)).size !== data.scenarios.length) throw new Error("같은 ID의 시나리오가 파일에 여러 개 있습니다");
    return { ...data, origin: data.origin ?? data.project.id, base: data.base ?? { scenarios: {}, suites: {} } };
  }

  private async readShareBases(): Promise<Record<string, ShareBase>> {
    const parsed = z.record(z.string().uuid(), z.object({ scenarios: z.record(z.string(), z.string()), suites: z.record(z.string(), z.string()) })).safeParse(await this.files.read("share-bases.json"));
    return parsed.success ? parsed.data : {};
  }

  /** Remembers the version both sides now have, sent along in this project's next share file (call inside the queue). */
  private async recordShareBase(projectId: string, scenarios: Array<{ id: string } & Parameters<typeof scenarioShareHash>[0]>, suites: Array<{ id: string } & Parameters<typeof suiteShareHash>[0]>) {
    await this.files.save("share-bases.json", { ...await this.readShareBases(), [projectId]: {
      scenarios: Object.fromEntries(scenarios.map(item => [item.id, scenarioShareHash(item)])),
      suites: Object.fromEntries(suites.map(suite => [suite.id, suiteShareHash(suite)])),
    } });
  }

  /** What importing would do: counts for a new project, and a three-way diff (against the file's base) for each local copy. */
  async planProjectImport(text: string): Promise<ApiProjectImportPlan> {
    const data = this.parseShareFile(text);
    // The team project takes a file in directly (nothing is replaced), so there is no copy to compare with.
    if (this.teamStore()) return { name: data.project.name, scenarios: data.scenarios.length, suites: data.suites.length, targets: [] };
    const origins = await this.readShareOrigins(), seen = await this.readShareBases();
    const targets: ApiProjectImportPlan["targets"] = [];
    const diff = <T extends { id: string; name: string }, L>(items: T[], locals: L[], localId: (item: L) => string, hash: (item: T | L) => string, base: Record<string, string>, taken: Record<string, string> = {}) => {
      const result: ApiShareDiff = { added: [], incoming: [], conflicts: [], mine: 0, same: 0 };
      for (const item of items) {
        const local = locals.find(candidate => localId(candidate) === item.id);
        if (!local) { result.added.push({ id: item.id, name: item.name }); continue; }
        const change = shareChange(hash(item), hash(local), base[item.id], taken[item.id]);
        if (change === "incoming") result.incoming.push({ id: item.id, name: item.name });
        else if (change === "conflict") result.conflicts.push({ id: item.id, name: item.name });
        else result[change]++;
      }
      return result;
    };
    for (const project of await this.files.listProjects()) {
      if (project.id !== data.origin && origins[project.id] !== data.origin) continue;
      targets.push({
        projectId: project.id, name: project.name,
        scenarios: diff(data.scenarios, await this.listScenarios(project.id), item => item.id, item => scenarioShareHash(item as Parameters<typeof scenarioShareHash>[0]), data.base.scenarios, seen[project.id]?.scenarios),
        suites: diff(data.suites, await this.listSuites(project.id), suite => suite.id, suite => suiteShareHash(suite as SavedApiSuite), data.base.suites, seen[project.id]?.suites),
        serversAdded: data.project.servers.filter(server => !project.servers.some(local => local.name === server.name)).map(server => server.name),
        environmentsAdded: data.project.environments.filter(environment => !project.environments.some(local => local.name === environment.name)).map(environment => environment.name),
      });
    }
    return { name: data.project.name, scenarios: data.scenarios.length, suites: data.suites.length, targets };
  }

  /**
   * Imports a share file. Without `update` it adds a new project (new project, server and
   * environment ids; scenario and suite ids kept so later files can update it). With `update` it
   * merges into that local copy of the same project: adds what is missing, applies changes made
   * only in the file, keeps changes made only locally, takes the file side only for the listed
   * conflicts, keeps the local base URLs and never deletes anything.
   */
  async importProject(text: string, update?: { projectId: string; scenarioIds: string[]; suiteIds: string[] }): Promise<ApiProjectImportResult> {
    const data = this.parseShareFile(text);
    const team = this.teamStore();
    if (team) {
      if (update) throw new Error("팀 프로젝트에는 공유 파일을 비교해 합칠 수 없습니다. 새 항목만 추가합니다");
      return this.importToTeam(team, data);
    }
    if (update) return this.mergeProject(data, z.object({ projectId: z.string().uuid(), scenarioIds: z.array(z.string().min(1).max(1000)).max(5000), suiteIds: z.array(z.string().uuid()).max(1000) }).strict().parse(update));
    const action = this.queue.then(async () => {
      const projects = await this.files.listProjects();
      const serverIds = new Map(data.project.servers.map(server => [server.id, randomUUID()]));
      const environmentIds = new Map(data.project.environments.map(environment => [environment.id, randomUUID()]));
      const names = new Set(projects.map(p => p.name));
      let name = data.project.name;
      // Shorten the name, not the number, so a 100-character name still gets a free " (n)".
      for (let n = 2; names.has(name); n++) name = `${data.project.name.slice(0, 100 - ` (${n})`.length)} (${n})`;
      const project = projectSchema.parse({
        id: randomUUID(), name,
        servers: data.project.servers.map(server => ({ ...server, id: serverIds.get(server.id)! })),
        environments: data.project.environments.map(environment => ({ ...environment, id: environmentIds.get(environment.id)!, baseUrls: Object.fromEntries(Object.entries(environment.baseUrls).flatMap(([id, url]) => serverIds.has(id) ? [[serverIds.get(id)!, url]] : [])) })),
      });
      const now = new Date().toISOString();
      const scenarios = data.scenarios.map(item => this.sharedScenario(item, now));
      const suites: SavedApiSuite[] = data.suites.map(suite => ({ ...suite, scenarioIds: suite.scenarioIds.filter(id => scenarios.some(item => item.id === id)), updatedAt: now })).filter(suite => suite.scenarioIds.length);
      const specUrls = data.specUrls.filter(item => serverIds.has(item.serverId) && environmentIds.has(item.environmentId));
      await this.files.save(`scenarios-${project.id}.json`, scenarios);
      await this.files.save(`suites-${project.id}.json`, suites);
      for (const item of specUrls) await this.files.save(`spec-source-${project.id}-${environmentIds.get(item.environmentId)}-${serverIds.get(item.serverId)}.json`, { url: item.url });
      await this.files.save("share-origins.json", { ...await this.readShareOrigins(), [project.id]: data.origin });
      await this.recordShareBase(project.id, data.scenarios, data.suites);
      // Last: the project only appears once everything it points at is written.
      await this.files.save("projects.json", [...projects, project]);
      return { project, scenarios: scenarios.length, suites: suites.length, specUrls: specUrls.length };
    });
    this.queue = action.catch(() => undefined);
    return action;
  }

  private sharedScenario(item: { id: string; source: string; draft?: boolean; groupPath?: string[]; tags?: string[] }, updatedAt: string): SavedApiScenario {
    return { id: item.id, name: this.parseSource(item.source).name, source: item.source, bindings: {}, updatedAt, draft: item.draft ?? false, ...(item.groupPath ? { groupPath: item.groupPath } : {}), ...(item.tags ? { tags: item.tags } : {}) };
  }

  private mergeProject(data: ReturnType<ApiWorkspace["parseShareFile"]>, update: { projectId: string; scenarioIds: string[]; suiteIds: string[] }): Promise<ApiProjectImportResult> {
    return this.mutate(update.projectId, async () => {
      const projects = await this.files.listProjects();
      const local = projects.find(project => project.id === update.projectId);
      const origins = await this.readShareOrigins();
      if (!local || (local.id !== data.origin && origins[local.id] !== data.origin)) throw new Error("이 파일과 같은 프로젝트가 아닙니다");
      // The sender's base is the last version both sides had, however often either side exported since.
      const base = data.base, seen = (await this.readShareBases())[local.id];
      // Servers and environments match by name; missing ones are added with the file's addresses.
      const serverIds = new Map(data.project.servers.map(server => [server.id, local.servers.find(candidate => candidate.name === server.name)?.id ?? randomUUID()]));
      const servers = [...local.servers, ...data.project.servers.filter(server => !local.servers.some(candidate => candidate.name === server.name)).map(server => ({ ...server, id: serverIds.get(server.id)! }))];
      const fileBaseUrls = (name: string) => Object.fromEntries(Object.entries(data.project.environments.find(environment => environment.name === name)?.baseUrls ?? {}).flatMap(([id, url]) => serverIds.has(id) ? [[serverIds.get(id)!, url]] : []));
      const environments = [
        ...local.environments.map(environment => ({ ...environment, baseUrls: { ...fileBaseUrls(environment.name), ...environment.baseUrls } })),
        ...data.project.environments.filter(environment => !local.environments.some(candidate => candidate.name === environment.name)).map(environment => ({ ...environment, id: randomUUID(), baseUrls: fileBaseUrls(environment.name) })),
      ].map(environment => ({ ...environment, baseUrls: Object.fromEntries(servers.map(server => [server.id, environment.baseUrls[server.id] ?? ""])) }));
      const merged = projectSchema.safeParse({ ...local, servers, environments });
      if (!merged.success) throw new Error("추가되는 서버·환경의 기본 주소가 없어 합칠 수 없습니다. 프로젝트 설정에서 주소를 채운 뒤 다시 가져오세요");
      const now = new Date().toISOString();
      let added = 0, updated = 0, kept = 0;
      const takeFile = (change: ReturnType<typeof shareChange>, id: string, conflictIds: string[]) => change === "incoming" || (change === "conflict" && conflictIds.includes(id));
      const scenarios = await this.listScenarios(local.id);
      for (const item of data.scenarios) {
        const index = scenarios.findIndex(candidate => candidate.id === item.id);
        if (index < 0) { scenarios.push(this.sharedScenario(item, now)); added++; continue; }
        const change = shareChange(scenarioShareHash(item), scenarioShareHash(scenarios[index]), base.scenarios[item.id], seen?.scenarios[item.id]);
        if (takeFile(change, item.id, update.scenarioIds)) {
          const { keptTitles } = scenarios[index];
          scenarios[index] = { ...this.sharedScenario(item, now), ...(keptTitles ? { keptTitles } : {}) }; updated++;
        } else if (change !== "same") kept++;
      }
      const suites = await this.listSuites(local.id);
      for (const suite of data.suites) {
        const next = { ...suite, scenarioIds: suite.scenarioIds.filter(id => scenarios.some(item => item.id === id)), updatedAt: now };
        const index = suites.findIndex(candidate => candidate.id === suite.id);
        if (index < 0) { if (next.scenarioIds.length) { suites.push(next); added++; } continue; }
        const change = shareChange(suiteShareHash(suite), suiteShareHash(suites[index]), base.suites[suite.id], seen?.suites[suite.id]);
        if (takeFile(change, suite.id, update.suiteIds) && next.scenarioIds.length) { suites[index] = next; updated++; }
        else if (change !== "same") kept++;
      }
      let specUrls = 0;
      for (const item of data.specUrls) {
        const environmentName = data.project.environments.find(environment => environment.id === item.environmentId)?.name;
        const environment = merged.data.environments.find(candidate => candidate.name === environmentName), serverId = serverIds.get(item.serverId);
        if (!environment || !serverId || await this.specUrl(local.id, environment.id, serverId)) continue;
        await this.files.save(`spec-source-${local.id}-${environment.id}-${serverId}.json`, { url: item.url }); specUrls++;
      }
      await this.files.save(`scenarios-${local.id}.json`, scenarios);
      await this.files.save(`suites-${local.id}.json`, suites);
      // Both sides now share the file's version as their common base.
      await this.recordShareBase(local.id, data.scenarios, data.suites);
      await this.files.save("projects.json", projects.map(project => project.id === local.id ? merged.data : project));
      return { project: merged.data, scenarios: scenarios.length, suites: suites.length, specUrls, merged: { added, updated, kept } };
    });
  }

  /** Team mode: copies one local project into the team project (see importToTeam), with its docs inputs and specs read. */
  async importLocalProject(rawProjectId: string): Promise<ApiProjectImportResult> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const team = this.teamStore();
    if (!team) throw new Error("팀 프로젝트에 로그인한 뒤 가져올 수 있습니다");
    const local = new ApiWorkspace(this.directory);
    const data = this.parseShareFile(await local.exportProject(projectId));
    return this.importToTeam(team, data, await this.files.docInputs(projectId), projectId);
  }

  /**
   * Adds a share file's project to the signed-in team project without replacing anything: servers
   * and environments match by name (missing ones are added, team addresses win, the file's fill
   * unset pairs), spec URLs fill unset pairs, and scenarios, suites and docs inputs are added when
   * their id is new. From a local project (`localProjectId`) its read specs and saved docs account
   * are copied too, so they need not be fetched again.
   */
  private importToTeam(team: TeamStore, data: ReturnType<ApiWorkspace["parseShareFile"]>, docInputs: Record<string, ApiDocInput> = {}, localProjectId?: string): Promise<ApiProjectImportResult> {
    return this.mutate(team.context.projectId, async () => {
      const current = (await team.listProjects())[0];
      const idByName = (items: Array<{ id: string; name: string }>) => {
        const ids = new Map(items.map(item => [item.name, item.id]));
        return (name: string) => ids.get(name) ?? ids.set(name, randomUUID()).get(name)!;
      };
      const serverId = idByName(current.servers), environmentId = idByName(current.environments);
      const serverIds = new Map(data.project.servers.map(server => [server.id, serverId(server.name)]));
      const environmentIds = new Map(data.project.environments.map(environment => [environment.id, environmentId(environment.name)]));
      const servers = [...current.servers];
      for (const server of data.project.servers) if (!servers.some(item => item.id === serverIds.get(server.id))) servers.push({ id: serverIds.get(server.id)!, name: server.name });
      const environments = [...current.environments];
      for (const environment of data.project.environments) {
        const id = environmentIds.get(environment.id)!;
        const fileUrls = Object.fromEntries(Object.entries(environment.baseUrls).map(([key, url]) => [serverIds.get(key)!, url]));
        const index = environments.findIndex(item => item.id === id);
        if (index < 0) environments.push({ id, name: environment.name, baseUrls: fileUrls });
        else environments[index] = { ...environments[index], baseUrls: { ...fileUrls, ...environments[index].baseUrls } };
      }
      await team.saveProject(parseTeamProject({ ...current, servers, environments }), current, []);
      const project = (await team.listProjects())[0];
      const known = await team.specUrls(project);
      let specUrls = 0;
      for (const item of data.specUrls) {
        const server = serverIds.get(item.serverId), environment = environmentIds.get(item.environmentId);
        if (!server || !environment || known.some(url => url.serverId === server && url.environmentId === environment)) continue;
        if (await team.setSpecUrl(environment, server, item.url)) { known.push({ serverId: server, environmentId: environment, url: item.url }); specUrls++; }
      }
      const now = new Date().toISOString();
      const scenarios = data.scenarios.map(item => this.sharedScenario(item, now));
      const existing = new Set([...(await team.listScenarios()).map(item => item.id), ...scenarios.map(item => item.id)]);
      const suites: SavedApiSuite[] = data.suites.map(suite => ({ ...suite, scenarioIds: suite.scenarioIds.filter(id => existing.has(id)), updatedAt: now })).filter(suite => suite.scenarioIds.length);
      const addedScenarios = await team.addScenarios(scenarios), addedSuites = await team.addSuites(suites);
      await team.addDocInputs(Object.fromEntries(Object.entries(docInputs).flatMap(([key, input]) => {
        const server = serverIds.get(key.slice(0, key.indexOf(" ")));
        return server ? [[`${server}${key.slice(key.indexOf(" "))}`, input]] : [];
      })));
      if (localProjectId) for (const environment of data.project.environments) for (const server of data.project.servers) {
        const [from, to] = [[localProjectId, environment.id, server.id], [project.id, environmentIds.get(environment.id), serverIds.get(server.id)]].map(ids => ids.join("-"));
        // Local caches only; one already there for the team pair stays.
        for (const kind of ["catalog", "spec-source"]) await copyFile(path.join(this.directory, `${kind}-${from}.json`), path.join(this.directory, `${kind}-${to}.json`), constants.COPYFILE_EXCL).catch(() => undefined);
      }
      const added = addedScenarios + addedSuites;
      return { project, scenarios: addedScenarios, suites: addedSuites, specUrls, merged: { added, updated: 0, kept: scenarios.length + suites.length - added } };
    });
  }

  /** "file": this computer only. "team": the signed-in team project, with local projects it can still take in once. */
  async getStorage(): Promise<ApiStorageInfo> {
    const team = this.teamStore();
    if (!team) return { mode: "file" };
    const locals = await this.files.listProjects().catch(() => []);
    const counts = locals.length ? await team.counts() : undefined;
    const importable = !counts || counts.scenarios || counts.suites ? [] : await Promise.all(locals.map(async project => ({
      id: project.id, name: project.name,
      scenarios: (await this.files.listScenarios(project.id)).length, suites: (await this.files.listSuites(project.id)).length,
    })));
    return { mode: "team", projectCode: team.context.projectCode, importable };
  }

  /** The team's spec URL of the scope (null when unset); undefined without sign-in, where SpecSync keeps it locally. */
  async sharedSpecUrl(input: ApiScope): Promise<string | null | undefined> {
    const team = this.teamStore();
    if (!team) return undefined;
    const { scope } = await this.scope(input);
    return team.specUrl(scope.environmentId, scope.serverId);
  }
  /** Team mode: a spec URL that imported fine becomes the team's for that server·environment. */
  async shareSpecUrl(input: ApiScope, url: string): Promise<void> {
    const team = this.teamStore();
    if (!team) return;
    const { scope } = await this.scope(input);
    await team.setSpecUrl(scope.environmentId, scope.serverId, url);
  }

  async deleteCatalog(input: ApiScope): Promise<void> {
    const scope = scopeSchema.parse(input);
    return this.mutate(scope.projectId, async () => {
      const project = (await this.projects()).find(p => p.id === scope.projectId);
      if (!project?.servers.some(s => s.id === scope.serverId) || !project.environments.some(e => e.id === scope.environmentId)) throw new Error("프로젝트·서버·환경을 선택하세요");
      await this.clearScope(scope);
    });
  }
  async deleteScenario(rawProjectId: string, rawId: string, revision: string): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const id = z.string().min(1).max(1000).parse(rawId);
    return this.mutate(projectId, async () => {
      await this.requireProject(projectId);
      if (!await this.store().deleteScenario(projectId, id, revision)) throw new Error("시나리오가 변경되었습니다. 최신 목록에서 다시 선택하세요");
    });
  }

  private authKey(scope: ApiScope) { return `${scope.projectId}:${scope.environmentId}:${scope.serverId}`; }
  async getRequestAuth(input: ApiScope): Promise<string | null> {
    const { scope, baseUrl } = await this.scope(input);
    const auth = this.requestAuth.get(this.authKey(scope));
    return auth?.baseUrl === baseUrl ? auth.variable : null;
  }
  async setRequestAuth(input: ApiScope, rawVariable: string | null): Promise<void> {
    const { scope, baseUrl } = await this.scope(input);
    if (this.projectIsActive(scope.projectId)) throw new Error("실행 중에는 인증 설정을 변경할 수 없습니다");
    if (rawVariable === null) { this.requestAuth.delete(this.authKey(scope)); return; }
    const variable = variableName.parse(rawVariable);
    this.authToken(scope, variable);
    this.requestAuth.set(this.authKey(scope), { variable, baseUrl });
  }
  private authToken(scope: ApiScope, variable: string): string {
    const token = this.runner.globals.snapshot(scope.projectId)[variable];
    if (typeof token !== "string" || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) throw new Error("인증 변수에 유효한 토큰 문자열이 없습니다. Bearer 접두사 없이 토큰을 저장하세요");
    return token;
  }

  /** `operations` are "<serverId> <METHOD path>"; with neither filter every API is offered. */
  private async aiServers(scope: ApiEnvironmentScope, project: ApiProject, tags?: string[], picked?: string[]) {
    const servers = [];
    for (const server of project.servers) {
      const catalog = await this.getCatalog({ ...scope, serverId: server.id });
      const operations = (catalog?.operations ?? [])
        .filter(operation => !operation.warnings.length)
        .filter(operation => (!tags?.length && !picked?.length)
          || Boolean(tags?.some(tag => operation.tag === tag || operation.tags?.includes(tag)))
          || Boolean(picked?.includes(`${server.id} ${operation.key}`)));
      if (operations.length) servers.push({ serverName: server.name, operations, spec: catalog?.spec });
    }
    if (!servers.length) throw new Error("현재 환경에 AI가 사용할 API 명세가 없습니다. API 문서 탭에서 명세를 가져오세요");
    return servers;
  }

  /** Masks string global values (tokens etc.) that a spec description or example might repeat. */
  private aiRedact(projectId: string): (text: string) => string {
    const secrets = Object.values(this.runner.globals.snapshot(projectId))
      .filter((value): value is string => typeof value === "string" && value.length >= 6)
      .sort((a, b) => b.length - a.length);
    return text => secrets.reduce((masked, secret) => masked.split(secret).join("***"), text);
  }

  /** Per-project exchange folder with the user's AI: the schema file it reads and the result file it writes. */
  private aiFiles(projectId: string) {
    const dir = path.join(this.directory, "ai", projectId);
    return { dir, catalog: path.join(dir, "api-catalog.json"), result: path.join(dir, "scenarios.yaml") };
  }

  /** What the guide tells the AI about saved work: globals with producers/consumers, groups, scenarios. */
  private async aiProjectSummary(projectId: string) {
    const saved = await this.listScenarios(projectId);
    const suites = await this.listSuites(projectId);
    const summary = new Map<string, { type?: string; producers: string[]; consumers: string[] }>();
    const entry = (name: string) => { let item = summary.get(name); if (!item) summary.set(name, item = { producers: [], consumers: [] }); return item; };
    for (const global of await this.listGlobals({ projectId })) entry(global.name).type = global.type;
    for (const item of saved) {
      let produced: string[] = [];
      try { produced = parseScenario(item.source).steps.flatMap(step => step.extract.map(extract => extract.target)).filter(target => target.startsWith("globals.")).map(target => target.slice(8)); } catch { /* broken drafts only list their uses */ }
      for (const name of new Set(produced)) entry(name).producers.push(item.name);
      const used = new Set([...item.source.matchAll(/\{\{\s*globals\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}|auth:\s*['"]?globals\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1] ?? match[2]));
      for (const name of used) entry(name).consumers.push(item.name);
    }
    const groupOf = (path?: string[]) => (path ?? []).join("/");
    return {
      globals: [...summary.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => ({ name, ...item })),
      groups: [...new Set([...saved, ...suites].map(item => groupOf(item.groupPath)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
      existing: saved.map(item => ({ name: item.name, group: groupOf(item.groupPath) })),
    };
  }

  /**
   * Guide the user pastes into their own AI (Claude Code, Codex…) in the backend project.
   * Writes the current detailed schemas next to the result file so the prompt stays short.
   */
  async buildAiPrompt(raw: unknown): Promise<string> {
    const request = aiGuideRequestSchema.parse(raw);
    const { scope, project } = await this.environment(request.scope);
    const servers = await this.aiServers(scope, project, request.tags, request.operations);
    const redact = this.aiRedact(scope.projectId);
    const files = this.aiFiles(scope.projectId);
    await mkdir(files.dir, { recursive: true });
    await writeFile(files.catalog, redact(JSON.stringify(aiCatalogDetails(servers), null, 1)), { mode: 0o600 });
    const prompt = redact(createAuthorPrompt({
      servers, ...await this.aiProjectSummary(scope.projectId),
      catalogFile: files.catalog, resultFile: files.result,
    }));
    if (Buffer.byteLength(prompt) > 1_000_000) throw new Error("API가 너무 많습니다. 태그로 범위를 좁히세요");
    return prompt;
  }

  /** What the user's AI last wrote to the result file; null when there is none yet. */
  async readAiResult(rawScope: unknown): Promise<{ path: string; text: string; modifiedAt: string } | null> {
    const { scope } = await this.environment(environmentScopeSchema.parse(rawScope));
    const file = this.aiFiles(scope.projectId).result;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    if (info.size > 2_000_000) throw new Error("AI 결과 파일은 2MB 이하만 불러올 수 있습니다");
    return { path: file, text: await readFile(file, "utf8"), modifiedAt: info.mtime.toISOString() };
  }

  /**
   * Checks what the user's AI wrote (scenarios separated by ---, optional suite
   * document, markdown fences allowed) with Checkly's own validation. Nothing is saved.
   */
  async checkAiScenarios(rawScope: unknown, rawText: unknown): Promise<ApiAiImportResult> {
    const { scope } = await this.environment(environmentScopeSchema.parse(rawScope));
    const bundle = splitAiBundle(z.string().max(2_000_000).parse(rawText));
    if (!bundle.scenarios.length) throw new Error("시나리오 YAML을 찾지 못했습니다. AI가 출력한 YAML을 그대로 붙여넣으세요");
    if (bundle.scenarios.length > 30) throw new Error("시나리오는 한 번에 30개까지 가져올 수 있습니다");
    return this.checkAiAnswer(scope, bundle, (await this.listScenarios(scope.projectId)).map(({ id, name, draft }) => ({ id, name, ...(draft ? { draft } : {}) })));
  }

  private async checkAiAnswer(scope: ApiEnvironmentScope, answer: AiBundle, existing: Array<{ id: string; name: string; draft?: boolean }>): Promise<ApiAiImportResult> {
    const existingIds = new Set(existing.map(item => item.id)), existingNames = new Set(existing.map(item => item.name));
    const drafts: ApiAiDraft[] = [];
    // Who makes each global: saved scenarios, and scenarios in this same result.
    const producers = new Map((await this.aiProjectSummary(scope.projectId)).globals.map(item => [item.name, [...item.producers]]));
    for (const written of answer.scenarios) {
      const name = aiScenarioName(written.yaml);
      if (!name) continue;
      for (const match of written.yaml.matchAll(/target:\s*['"]?globals\.([A-Za-z][A-Za-z0-9_]*)/g)) producers.set(match[1], [...(producers.get(match[1]) ?? []), name]);
    }
    // One line per missing global ("1·2단계: …") naming what makes it, instead of the same message for every step.
    const describeIssues = (issues: string[]) => {
      const { globals, others } = groupMissingGlobals(issues);
      return [...globals.map(({ name, steps }) => {
        const from = producers.get(name)?.[0];
        return `${steps.length ? `${stepNumbersText(steps)}단계: ` : ""}전역변수 '${name}' 값이 없습니다. ${from ? `'${from}'을(를) 먼저 실행하면 만들어집니다` : "전역변수에서 설정하세요"}`;
      }), ...others];
    };
    for (const [index, written] of answer.scenarios.entries()) {
      // One saved scenario with the same name: this result is a new version of it, so it keeps that id
      // (saving updates it). The user can still choose to add it as a new scenario.
      const writtenName = aiScenarioName(written.yaml);
      const sameSaved = writtenName ? existing.filter(item => item.name === writtenName) : [];
      // Only the first draft of that name may take it (a second one in the same result stays new).
      const replaceable = sameSaved.length === 1 && !drafts.some(draft => draft.replaces === sameSaved[0].id) ? sameSaved[0].id : undefined;
      const yaml = withGeneratedId(written.yaml, replaceable);
      let id = `ai-draft-${index + 1}`, name = `AI 시나리오 ${index + 1}`, stepCount = 0;
      const issues: string[] = [], notices: string[] = [];
      let executionIssues: string[] = [];
      try {
        const preview = await this.previewScenario(scope, yaml, {});
        ({ id, name } = preview.scenario);
        stepCount = preview.scenario.steps.length;
        issues.push(...preview.issues);
        executionIssues = describeIssues(preview.executionIssues ?? []);
      } catch (error) {
        issues.push(`YAML 오류: ${(error as Error).message}`);
        // Keep the written name so the list and the suite still recognise this scenario.
        name = aiScenarioName(written.yaml) ?? name;
      }
      const replaces = replaceable !== undefined && id === replaceable ? replaceable : undefined;
      if (existingIds.has(id) && !replaces) issues.push(`id '${id}'가 기존 시나리오와 겹칩니다. id를 지우면 Checkly가 새로 붙입니다`);
      if (drafts.some(draft => draft.id === id)) issues.push(`id '${id}'가 이번 결과의 다른 시나리오와 겹칩니다`);
      if (drafts.some(draft => draft.name === name)) issues.push(`이름 '${name}'이 이번 결과의 다른 시나리오와 겹칩니다. 스위트 순서를 알 수 없습니다`);
      const sameName = existingNames.has(name);
      if (sameName) notices.push(replaces ? "같은 이름의 기존 시나리오가 있습니다. 저장하면 그 시나리오를 이 내용으로 업데이트합니다" : "같은 이름의 시나리오가 이미 있습니다. 저장하면 같은 이름이 하나 더 생깁니다");
      const group = aiGroupPath(written.group);
      if (group.error) issues.push(group.error);
      drafts.push({ id, name, yaml, stepCount, issues, notices, executionIssues, ...(group.path ? { groupPath: group.path } : {}), ...(sameName ? { sameName: true as const } : {}), ...(replaces ? { replaces } : {}) });
    }
    let suite: ApiAiImportResult["suite"] = null;
    if (answer.suite) {
      const problems: string[] = [];
      // Scenarios are referenced by name; an explicit id also works. Saved scenarios (e.g. a login that
      // makes the token) can be reused by their name, as the guide asks.
      // Only saved, runnable scenarios can join a suite; drafts are refused by saveSuite.
      const runnableSaved = (name: string) => existing.filter(item => item.name === name && !item.draft);
      const reused: Record<string, string> = {}, fallbacks: Record<string, string> = {};
      const scenarioIds = answer.suite.scenarios.map(ref => {
        const draft = drafts.find(item => item.name === ref) ?? drafts.find(item => item.id === ref);
        if (draft) {
          // A same-name draft starts unselected; if it isn't saved, the suite keeps the existing one.
          const same = draft.sameName ? runnableSaved(draft.name) : [];
          if (same.length === 1) { fallbacks[draft.id] = same[0].id; reused[same[0].id] = same[0].name; }
          return draft.id;
        }
        const named = existing.filter(item => item.name === ref), saved = runnableSaved(ref);
        if (saved.length === 1) { reused[saved[0].id] = saved[0].name; return saved[0].id; }
        problems.push(saved.length ? `스위트의 '${ref}'와 이름이 같은 기존 시나리오가 여러 개입니다` : named.length ? `스위트의 '${ref}'는 실행할 수 없는 초안이라 넣을 수 없습니다` : `스위트의 '${ref}'가 이번 결과와 기존 시나리오 이름에 없습니다`);
        return ref;
      });
      if (!scenarioIds.length) problems.push("스위트에 시나리오가 없습니다");
      const group = aiGroupPath(answer.suite.group);
      if (group.error) problems.push(group.error);
      suite = { name: answer.suite.name.trim() || "AI 스위트", scenarioIds, problems, ...(group.path ? { groupPath: group.path } : {}), ...(Object.keys(reused).length ? { saved: reused } : {}), ...(Object.keys(fallbacks).length ? { fallbacks } : {}) };
    }
    return { drafts, suite };
  }

  /** Last "Try it out" values per API of the scope's server (secret-looking names are never stored). */
  async getDocInputs(input: ApiScope): Promise<Record<string, ApiDocInput>> {
    const { scope } = await this.scope(input);
    const prefix = `${scope.serverId} `;
    // Keyed by "<serverId> <METHOD path>"; project-wide like globals, so every environment shares them.
    return Object.fromEntries(Object.entries(await this.store().docInputs(scope.projectId)).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
  }

  async forgetDocInput(input: ApiScope, rawKey: string): Promise<void> {
    const { scope } = await this.scope(input);
    const key = `${scope.serverId} ${z.string().min(1).max(2000).parse(rawKey)}`;
    await this.setDocInput(scope.projectId, key, undefined);
  }

  private setDocInput(projectId: string, key: string, input: ApiDocInput | undefined): Promise<void> {
    const action = this.queue.then(() => this.store().setDocInput(projectId, key, input));
    this.queue = action.catch(() => undefined);
    return action;
  }

  /** Without sign-in: this computer's projects. Signed in: only the team project (it may lack servers or environments yet). */
  async listProjects(): Promise<ApiProject[]> {
    return this.store().listProjects();
  }
  async saveProject(input: unknown): Promise<ApiProject> {
    const team = this.teamStore();
    const project = team ? parseTeamProject(input) : projectSchema.parse(input);
    if (team && project.id !== team.context.projectId) throw new Error("팀 프로젝트에 로그인한 동안에는 API 프로젝트를 새로 만들 수 없습니다");
    return this.mutate(project.id, async () => {
      const store = this.store();
      const previous = (await store.listProjects()).find(p => p.id === project.id);
      const renames: ScenarioRename[] = [];
      if (previous) {
        if (previous.servers.some(old => project.servers.some(next => next.id === old.id && next.name !== old.name))) {
          for (const item of await this.listScenarios(project.id)) {
            const scenario = this.parseSource(item.source);
            let changed = false;
            const steps = scenario.steps.map(step => {
              const key = item.bindings[step.server] ?? step.server;
              const old = previous.servers.find(server => server.id === key || server.name === key);
              const next = old && project.servers.find(server => server.id === old.id);
              if (!next) return step;
              if (step.server !== next.name) changed = true;
              return { ...step, server: next.name };
            });
            if (changed) renames.push({ before: item, after: { ...item, source: stringifyScenario({ ...scenario, steps }, true), bindings: {}, updatedAt: new Date(Math.max(Date.now(), Date.parse(item.updatedAt) + 1)).toISOString() } });
          }
        }
        const removedServers = previous.servers.filter(s => !project.servers.some(n => n.id === s.id));
        const removedEnvironments = previous.environments.filter(e => !project.environments.some(n => n.id === e.id));
        if (removedServers.length || removedEnvironments.length) {
          const scenarios = await this.listScenarios(project.id);
          const affected = scenarios.filter(item => {
            if (removedEnvironments.length) return true; // Scenarios are project-wide and can run in every environment.
            const scenario = this.parseSource(item.source);
            return scenario.steps.some(step => removedServers.some(s => s.id === (item.bindings[step.server] ?? step.server) || s.name === step.server));
          });
          if (affected.length) throw new Error(`시나리오 참조를 먼저 정리하세요: ${affected.map(s => s.name).join(", ")}`);
          for (const env of previous.environments) {
            for (const server of previous.servers) if (removedEnvironments.some(e => e.id === env.id) || removedServers.some(s => s.id === server.id)) await this.clearScope({ projectId: project.id, environmentId: env.id, serverId: server.id });
          }
        }
      }
      await store.saveProject(project, previous, renames);
      // The team project comes back with its new revision.
      return team ? (await store.listProjects())[0] : project;
    });
  }
  private async scope(input: ApiScope) {
    const s = scopeSchema.parse(input);
    const project = (await this.projects()).find(p => p.id === s.projectId);
    this.assertAvailable(s.projectId);
    const environment = project?.environments.find(e => e.id === s.environmentId);
    const server = project?.servers.find(v => v.id === s.serverId);
    if (!environment || !server) throw new Error("프로젝트·서버·환경을 선택하세요");
    // "" only in a team project, whose addresses may be left unset for now.
    return { scope: s, baseUrl: environment.baseUrls[s.serverId] ?? "", server, environment };
  }
  private filename(s: ApiScope) { return `catalog-${s.projectId}-${s.environmentId}-${s.serverId}.json`; }
  private async readCatalog(scope: ApiScope): Promise<ApiCatalog | null> {
    const filename = this.filename(scope);
    if (this.catalogCache.has(filename)) return this.catalogCache.get(filename)!;
    const catalog = await this.files.read(filename) as ApiCatalog | null;
    let current = catalog;
    // Catalogs persist the source spec as well as the derived operations. Rebuild
    // derived metadata when an older app version left stale support warnings.
    if (catalog?.spec && catalog.operations?.some(operation => operation.warnings.length > 0)) {
      try {
        const refreshed = readOpenApi(JSON.stringify(catalog.spec));
        current = { ...catalog, title: refreshed.title, version: refreshed.version, operations: refreshed.operations, tags: refreshed.tags };
      } catch {
        // Keep the saved catalog if its legacy spec cannot be parsed by the current reader.
      }
    }
    this.catalogCache.set(filename, current);
    return current;
  }
  async getCatalog(input: ApiScope): Promise<ApiCatalog | null> {
    const { scope } = await this.scope(input);
    return this.readCatalog(scope);
  }
  async importSpec(input: ApiScope, source: string): Promise<ApiCatalog> {
    const release = this.beginSpecSync(input);
    try {
      const { scope } = await this.scope(input);
      const previous = await this.readCatalog(scope).catch(() => null);
      const catalog: ApiCatalog = readOpenApi(source);
      // Remember titles that changed since the last import, so steps named after the old
      // title can be offered the new one. Pending older titles are kept until renamed.
      const titleChanges: NonNullable<ApiCatalog["titleChanges"]> = {};
      for (const operation of catalog.operations) {
        const before = previous?.operations.find(candidate => candidate.key === operation.key);
        const pending = previous?.titleChanges?.[operation.key]?.from ?? [];
        const from = [...new Set([...pending, ...(before && before.summary !== operation.summary && before.summary ? [before.summary] : [])])].filter(title => title !== operation.summary);
        if (from.length) titleChanges[operation.key] = { from, to: operation.summary };
      }
      if (Object.keys(titleChanges).length) catalog.titleChanges = titleChanges;
      await this.files.save(this.filename(scope), catalog);
      this.catalogCache.set(this.filename(scope), catalog);
      return catalog;
    } finally { release(); }
  }

  private async environment(input: ApiEnvironmentScope) {
    const scope = environmentScopeSchema.parse(input);
    const project = (await this.projects()).find(p => p.id === scope.projectId);
    this.assertAvailable(scope.projectId);
    const environment = project?.environments.find(e => e.id === scope.environmentId);
    if (!project || !environment) throw new Error("프로젝트·환경을 선택하세요");
    return { scope, project, environment };
  }

  private async project(input: ApiProjectScope) {
    const scope = projectScopeSchema.parse(input);
    const project = (await this.projects()).find(p => p.id === scope.projectId);
    this.assertAvailable(scope.projectId);
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다");
    return { scope, project };
  }

  private projectIsActive(projectId: string) {
    return [...this.active.keys()].some(key => key.startsWith(`${projectId}:`));
  }

  async listGlobals(input: ApiProjectScope): Promise<ApiGlobal[]> {
    const { scope } = await this.project(input);
    return Object.entries(this.runner.globals.snapshot(scope.projectId)).map(([name, value]) => ({
      name, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value, displayValue: typeof value === "string" ? value : JSON.stringify(value),
    }));
  }

  async setGlobal(input: ApiProjectScope, rawName: string, rawValue: Json) {
    const { scope } = await this.project(input);
    const name = variableName.parse(rawName);
    const value = z.json().parse(rawValue);
    if (JSON.stringify(value).length > 100_000) throw new Error("변수는 100KB 이하만 저장할 수 있습니다");
    if (this.projectIsActive(scope.projectId)) throw new Error("실행 중에는 전역변수를 변경할 수 없습니다");
    this.runner.globals.commit(scope.projectId, { [name]: value });
  }

  async deleteGlobal(input: ApiProjectScope, rawName: string) {
    const { scope } = await this.project(input);
    const name = variableName.parse(rawName);
    if (this.projectIsActive(scope.projectId)) throw new Error("실행 중에는 전역변수를 변경할 수 없습니다");
    this.runner.globals.delete(scope.projectId, name);
  }

  async listCookies(input: ApiProjectScope): Promise<ApiCookie[]> {
    const { scope } = await this.project(input);
    return this.cookieJars.get(scope.projectId)?.list() ?? [];
  }

  async clearCookies(input: ApiProjectScope): Promise<void> {
    const { scope } = await this.project(input);
    if (this.projectIsActive(scope.projectId)) throw new Error("실행 중에는 쿠키를 비울 수 없습니다");
    this.cookieJars.get(scope.projectId)?.clear();
  }

  async listScenarios(rawProjectId: string): Promise<SavedApiScenario[]> {
    const projectId = z.string().uuid().parse(rawProjectId);
    await this.requireProject(projectId);
    return (await this.store().listScenarios(projectId)).map(item => migrateSidebarMetadata(item) as unknown as SavedApiScenario);
  }

  async listSuites(rawProjectId: string): Promise<SavedApiSuite[]> {
    const projectId = z.string().uuid().parse(rawProjectId);
    await this.requireProject(projectId);
    // Team rows carry the database time (with offset and microseconds); it goes back as is when saving.
    return z.array(suiteSchema.extend({ updatedAt: z.string().datetime({ offset: true }) })).parse((await this.store().listSuites(projectId)).map(migrateSidebarMetadata));
  }

  async saveSuite(rawProjectId: string, rawSuite: Omit<SavedApiSuite, "updatedAt">, expectedUpdatedAt?: string): Promise<SavedApiSuite> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const suite = suiteSchema.parse(rawSuite);
    const action = this.queue.then(async () => {
      const scenarios = await this.listScenarios(projectId);
      if (suite.scenarioIds.some(id => !scenarios.some(item => item.id === id && !item.draft))) throw new Error("저장된 실행 가능 시나리오만 묶음에 추가하세요");
      const previous = (await this.listSuites(projectId)).find(item => item.id === suite.id);
      const item: SavedApiSuite = { ...suite, updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString() };
      const stored = await this.store().putSuite(projectId, item, expectedUpdatedAt);
      if (!stored) throw new Error("묶음이 변경되었습니다. 최신 목록에서 다시 선택하세요");
      return stored;
    });
    this.queue = action.catch(() => undefined);
    return action;
  }

  async deleteSuite(rawProjectId: string, rawId: string, expectedUpdatedAt: string): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const id = z.string().uuid().parse(rawId);
    const action = this.queue.then(async () => {
      await this.requireProject(projectId);
      if (!await this.store().deleteSuite(projectId, id, expectedUpdatedAt)) throw new Error("묶음이 변경되었습니다. 최신 목록에서 다시 선택하세요");
    });
    this.queue = action.catch(() => undefined);
    return action;
  }

  private parseSource(source: string): Scenario {
    if (typeof source !== "string" || Buffer.byteLength(source) > 1_000_000) throw new Error("시나리오 YAML은 1MB 이하로 입력하세요");
    try { return pruneUnusedBrokenBindings(parseScenario(source)); }
    catch (e) {
      if (e instanceof z.ZodError) throw new Error(e.issues.map(i => `${i.path.join(".") || "시나리오"}: ${i.message}`).join("\n"));
      // Retired syntax, undefined inputs, future step references: the message says how to fix it.
      if (e instanceof ScenarioFormatError) throw new Error(e.message);
      throw new Error("YAML 문법이 올바르지 않습니다. 들여쓰기와 중복 키를 확인하세요");
    }
  }

  /**
   * How the current environment's specs affect saved scenarios: steps whose API is gone
   * (e.g. a renamed path) and steps still named after a title the spec has since changed.
   * Reads each server's catalog once for all scenarios.
   */
  async checkScenarioSpecs(input: ApiEnvironmentScope): Promise<ApiSpecImpact> {
    const { scope, project } = await this.environment(input);
    const catalogs = new Map<string, ApiCatalog | null>();
    for (const server of project.servers) catalogs.set(server.id, await this.readCatalog({ ...scope, serverId: server.id }));
    const missing: ApiMissingApi[] = [];
    const renamed: ApiTitleRename[] = [];
    for (const item of await this.listScenarios(scope.projectId)) {
      let scenario: Scenario;
      try { scenario = this.parseSource(item.source); } catch { continue; }
      const gone: string[] = [];
      const titles: Array<{ from: string; to: string }> = [];
      for (const step of scenario.steps) {
        const key = item.bindings[step.server] ?? step.server;
        const server = project.servers.find(candidate => candidate.id === key) ?? project.servers.find(candidate => candidate.name === key);
        const catalog = server ? catalogs.get(server.id) : undefined;
        if (!catalog) continue; // No spec for that server is a different problem, reported elsewhere.
        const api = step.api;
        const matches = catalog.operations.filter(o => "operationId" in api ? o.operationId === api.operationId : o.method === api.method && o.path === api.path);
        if (matches.length !== 1) { gone.push(`${scenarioStepLabel(step)} (${"operationId" in api ? api.operationId : `${api.method} ${api.path}`})`); continue; }
        const change = catalog.titleChanges?.[matches[0].key];
        if (step.name && change && change.from.includes(step.name) && step.name !== change.to && !keptTitle(item, step.name, change.to)) titles.push({ from: step.name, to: change.to });
      }
      if (gone.length) missing.push({ scenarioId: item.id, scenario: item.name, steps: gone });
      if (titles.length) renamed.push({ scenarioId: item.id, scenario: item.name, steps: titles });
    }
    return { missing, renamed };
  }

  /** Renames steps still named after an old spec title; each scenario is saved as before (draft stays draft). */
  async applyTitleRenames(input: ApiEnvironmentScope): Promise<{ updated: string[]; skipped: string[] }> {
    const { scope, project } = await this.environment(input);
    const { renamed } = await this.checkScenarioSpecs(scope);
    const updated: string[] = [], skipped: string[] = [];
    const saved = await this.listScenarios(scope.projectId);
    const catalogs = new Map<string, ApiCatalog | null>();
    if (renamed.length) for (const server of project.servers) catalogs.set(server.id, await this.readCatalog({ ...scope, serverId: server.id }));
    for (const target of renamed) {
      const item = saved.find(candidate => candidate.id === target.scenarioId);
      if (!item) continue;
      try {
        const scenario = this.parseSource(item.source);
        for (const step of scenario.steps) {
          const key = item.bindings[step.server] ?? step.server;
          const server = project.servers.find(candidate => candidate.id === key) ?? project.servers.find(candidate => candidate.name === key);
          const api = step.api;
          const operation = server && catalogs.get(server.id)?.operations.find(o => "operationId" in api ? o.operationId === api.operationId : o.method === api.method && o.path === api.path);
          const change = operation ? catalogs.get(server!.id)?.titleChanges?.[operation.key] : undefined;
          if (step.name && change?.from.includes(step.name) && !keptTitle(item, step.name, change.to)) step.name = change.to;
        }
        // Only names change, so problems the scenario already had (e.g. an API gone from the spec)
        // do not block it; a scenario edited elsewhere meanwhile is still skipped.
        await this.persistScenario(scope, stringifyScenario(scenario, true), item.bindings, item.updatedAt, item.draft ?? false, undefined, true);
        updated.push(item.name);
      } catch { skipped.push(item.name); }
    }
    return { updated, skipped };
  }

  /** Stops suggesting the scenario's current title renames; the names stay as they are. */
  async keepTitles(input: ApiEnvironmentScope, rawScenarioId: string): Promise<void> {
    const scenarioId = z.string().min(1).max(1000).parse(rawScenarioId);
    const pending = (await this.checkScenarioSpecs(input)).renamed.find(item => item.scenarioId === scenarioId)?.steps ?? [];
    if (!pending.length) return;
    const action = this.queue.then(async () => {
      const item = (await this.listScenarios(input.projectId)).find(candidate => candidate.id === scenarioId);
      // Metadata only: updatedAt stays, so an editor open on this scenario can still save.
      const keptTitles = [...(item?.keptTitles ?? []).filter(kept => !pending.some(step => step.from === kept.from)), ...pending];
      if (!item || !await this.store().keepTitles(input.projectId, scenarioId, keptTitles)) throw new Error("시나리오를 찾을 수 없습니다");
    });
    this.queue = action.catch(() => undefined);
    return action;
  }

  async previewScenario(input: ApiEnvironmentScope, source: string, rawBindings: Record<string, string>): Promise<ApiScenarioPreview> {
    const { scope, project, environment } = await this.environment(input);
    const scenario = this.parseSource(source);
    const bindings = bindingSchema.parse(rawBindings);
    // Resolve names only for this preview/run; persisted YAML uses the current name.
    scenario.steps = scenario.steps.map(step => {
      const key = bindings[step.server] ?? step.server;
      const server = project.servers.find(server => server.id === key) ?? project.servers.find(server => server.name === key);
      return server ? { ...step, server: server.id } : step;
    });
    const issues: string[] = [];
    const executionIssues: string[] = [];
    const availableGlobals = new Set(Object.entries(this.runner.globals.snapshot(scope.projectId)).filter(([, value]) => value !== null && value !== "").map(([name]) => name));
    const producedGlobals = new Set<string>();
    if (scenario.environments && !scenario.environments.includes(environment.name)) issues.push(`지원 환경: ${scenario.environments.join(", ")} · 현재 환경: ${environment.name}`);
    const catalogs = new Map<string, ApiCatalog | null>();
    const variables = new Set(Object.keys(scenario.vars));
    const stepIndexes = new Map(scenario.steps.map((step, index) => [step.id, index]));
    const bindingNames = new Map<string, number>();
    const variableUses = new Map<string, number[]>();
    const collectVariableUses = (value: unknown, index: number) => {
      if (typeof value === "string") {
        for (const match of value.matchAll(/\{\{(vars)\.([A-Za-z][A-Za-z0-9_]*)\}\}/g)) {
          const uses = variableUses.get(match[2]) ?? [];
          uses.push(index); variableUses.set(match[2], uses);
        }
      } else if (Array.isArray(value)) value.forEach(item => collectVariableUses(item, index));
      else if (value && typeof value === "object") Object.values(value).forEach(item => collectVariableUses(item, index));
    };
    scenario.steps.forEach((step, index) => { collectVariableUses(step.request, index); collectVariableUses(step.expect, index); });
    for (const binding of scenario.valueBindings) {
      const sourceIndex = stepIndexes.get(binding.step);
      if (sourceIndex === undefined) {
        issues.push(`${bindingUseLocations(scenario, binding.name).join(", ")}의 연결 출처가 삭제되었습니다. 해당 값 연결에서 출처를 다시 선택하세요.`);
        continue;
      }
      if (bindingNames.has(binding.name) || Object.hasOwn(scenario.vars, binding.name) || scenario.steps.some(step => step.extract.some(extract => extract.target === `vars.${binding.name}`))) {
        issues.push(`값 변수 '${binding.name}'가 이미 사용 중입니다`);
      }
      bindingNames.set(binding.name, sourceIndex);
      for (const useIndex of variableUses.get(binding.name) ?? []) {
        if (sourceIndex >= useIndex) issues.push(`값 순서 오류: '${binding.name}'의 출처 단계(${sourceIndex + 1})가 사용 단계(${useIndex + 1})보다 앞서야 합니다`);
      }
    }
    for (const [index, step] of scenario.steps.entries()) {
      const stepName = scenarioStepLabel(step);
      const executionLabel = `${index + 1}단계 · ${stepName}`;
      const auth = step.auth === "none" ? undefined : step.auth ?? scenario.auth;
      if (auth) {
        const variable = auth.slice("globals.".length);
        if (Object.keys(step.request.headers ?? {}).some(name => name.toLowerCase() === "authorization")) issues.push(`${executionLabel}: 단계 인증과 Authorization 헤더가 중복됩니다`);
        if (!availableGlobals.has(variable)) executionIssues.push(`${executionLabel}: 인증 전역변수 '${variable}' 값이 없습니다. 전역변수에서 설정하세요`);
        else if (!producedGlobals.has(variable)) {
          const token = this.runner.globals.snapshot(scope.projectId)[variable];
          if (typeof token !== "string" || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) executionIssues.push(`${executionLabel}: 인증 전역변수 '${variable}'는 Bearer 접두사 없는 토큰 문자열이어야 합니다`);
        }
      }
      for (const binding of scenario.valueBindings) {
        const sourceIndex = stepIndexes.get(binding.step);
        if (sourceIndex !== undefined && sourceIndex < index) variables.add(binding.name);
      }
      const serverId = bindings[step.server] ?? step.server;
      if (!environment.baseUrls[serverId]) executionIssues.push(`${executionLabel}: ${project.servers.some(s => s.id === serverId) ? unsetAddress(project.servers.find(s => s.id === serverId)!.name, environment.name) : "서버 기본 URL을 환경 설정에서 지정하세요"}`);
      if (!project.servers.some(s => s.id === serverId)) issues.push(`${stepName}: 서버 '${step.server}'를 연결하세요`);
      else {
        if (!catalogs.has(serverId)) catalogs.set(serverId, await this.getCatalog({ ...scope, serverId }));
        const api = step.api;
        const matches = catalogs.get(serverId)?.operations.filter(o => "operationId" in api ? o.operationId === api.operationId : o.method === api.method && o.path === api.path) ?? [];
        // No spec in this environment at all: one line for the server, not "API not in spec" for every step.
        if (!catalogs.get(serverId)) issues.push(`${project.servers.find(s => s.id === serverId)?.name ?? "서버"}: ${environment.name} 환경에 가져온 명세가 없습니다. API 문서 탭에서 명세를 가져오세요`);
        else if (matches.length !== 1) issues.push(`${stepName}: ${"operationId" in api ? api.operationId : `${api.method} ${api.path}`}${matches.length ? "는 명세에 같은 API가 여러 개 있습니다" : "는 명세에 없는 API입니다"}`);
        else {
          const op = matches[0];
          issues.push(...op.warnings.map(w => `${stepName}: ${w}`));
          for (const p of op.parameters.filter(p => p.required)) {
            const values = p.location === "path" ? step.request.pathParams : p.location === "query" ? step.request.query : p.location === "cookie" ? step.request.cookies : step.request.headers;
            // Cookies can be issued by an earlier response (or by this first request),
            // so an empty cookie is resolved by the runner's session jar at runtime.
            if (p.location !== "cookie" && !(p.location === "header" && p.name.toLowerCase() === "authorization" && auth) && !Object.entries(values ?? {}).some(([k, v]) => (p.location === "header" ? k.toLowerCase() === p.name.toLowerCase() : k === p.name) && v !== "")) issues.push(`${stepName}: 필수 입력 '${p.name}'이 없습니다`);
          }
          if (op.bodyRequired && step.request.body === undefined) issues.push(`${stepName}: 요청 본문이 필요합니다`);
        }
      }
      scenarioStepInputs(step).forEach(input => variables.add(input.name));
      const check = (v: unknown) => {
        if (typeof v === "string") {
          for (const match of v.matchAll(/\{\{globals\.([A-Za-z][A-Za-z0-9_]*)\}\}/g)) {
            if (!availableGlobals.has(match[1])) executionIssues.push(`${executionLabel}: 전역변수 '${match[1]}' 값이 없습니다. 전역변수에서 설정하세요`);
          }
          for (const match of v.matchAll(/\{\{(vars|inputs)\.([A-Za-z][A-Za-z0-9_]*)\}\}/g)) {
            const declaredByBinding = match[1] === "vars" && bindingNames.has(match[2]);
            if (match[1] === "vars" ? !variables.has(match[2]) && !declaredByBinding : !Object.hasOwn(scenario.inputs, match[2])) issues.push(`${stepName}: ${match[1]}.${match[2]}는 이 단계 전에 정의되지 않았습니다`);
          }
        } else if (v && typeof v === "object") Object.values(v).forEach(check);
      };
      check(step.request); check(step.expect);
      // Earlier extractions replace stored values; validate their tokens when the request runs.
      step.extract.filter(e => e.target.startsWith("globals.")).forEach(e => {
        const name = e.target.slice(8);
        availableGlobals.add(name);
        producedGlobals.add(name);
      });
      step.extract.filter(e => e.target.startsWith("vars.")).forEach(e => variables.add(e.target.slice(5)));
    }
    return { scenario, issues: [...new Set(issues)], executionIssues: [...new Set(executionIssues)] };
  }

  async saveScenario(input: ApiEnvironmentScope, source: string, bindings: Record<string, string>, expectedUpdatedAt?: string, metadata?: ApiSidebarMetadata): Promise<SavedApiScenario> {
    return this.persistScenario(input, source, bindings, expectedUpdatedAt, false, metadata);
  }

  async saveScenarioDraft(input: ApiEnvironmentScope, source: string, bindings: Record<string, string>, expectedUpdatedAt?: string, metadata?: ApiSidebarMetadata): Promise<SavedApiScenario> {
    return this.persistScenario(input, source, bindings, expectedUpdatedAt, true, metadata);
  }

  private async persistScenario(input: ApiEnvironmentScope, source: string, bindings: Record<string, string>, expectedUpdatedAt: string | undefined, draft: boolean, rawMetadata?: ApiSidebarMetadata, allowIssues = false): Promise<SavedApiScenario> {
    const metadata = rawMetadata === undefined ? undefined : sidebarMetadataSchema.parse(rawMetadata);
    const action = this.queue.then(async () => {
      // Validate inside the queue so project/server changes queued earlier are already applied
      // and ones queued later see this scenario when checking references.
      const preview = await this.previewScenario(input, source, bindings);
      if (!draft && !allowIssues && preview.issues.length) throw new Error(preview.issues.join("\n"));
      const { project } = await this.environment(input);
      const previous = (await this.listScenarios(input.projectId)).find(s => s.id === preview.scenario.id);
      const named = { ...preview.scenario, steps: preview.scenario.steps.map(step => ({ ...step, server: project.servers.find(server => server.id === step.server)?.name ?? step.server })) };
      const item: SavedApiScenario = {
        id: preview.scenario.id, name: preview.scenario.name, source: stringifyScenario(named, true), bindings: {}, updatedAt: new Date().toISOString(), draft,
        ...(metadata?.groupPath !== undefined ? { groupPath: metadata.groupPath } : metadata === undefined && previous?.groupPath ? { groupPath: previous.groupPath } : {}),
        ...(metadata?.tags !== undefined ? { tags: metadata.tags } : previous?.tags ? { tags: previous.tags } : {}),
        ...(previous?.keptTitles ? { keptTitles: previous.keptTitles } : {}),
      };
      const stored = await this.store().putScenario(input.projectId, item, expectedUpdatedAt);
      // With the version that was read: it changed meanwhile (a teammate or another screen saved first).
      if (!stored) throw new Error(expectedUpdatedAt ? "그 사이 다른 곳(팀원·다른 화면)에서 이 시나리오를 저장했습니다. 목록에서 최신 시나리오를 열어 다시 수정하세요" : "같은 ID의 시나리오가 있습니다. 목록에서 최신 시나리오를 열어 수정하세요");
      return stored;
    });
    this.queue = action.catch(() => undefined);
    return action;
  }

  async runScenario(input: ApiEnvironmentScope, source: string, bindings: Record<string, string>, rawInputs: Record<string, Json>, options: ApiScenarioRunOptions = {}): Promise<ApiScenarioResult> {
    const { scope, environment } = await this.environment(input);
    const preview = await this.previewScenario(scope, source, bindings);
    if (preview.issues.length || preview.executionIssues?.length) throw new Error([...preview.issues, ...(preview.executionIssues ?? [])].join("\n"));
    const inputs = z.record(z.string(), z.json()).parse(rawInputs);
    const scenario = preview.scenario;
    const servers = Object.fromEntries([...new Set(scenario.steps.map(s => s.server))].map(key => [key, { baseUrl: environment.baseUrls[bindings[key] ?? key] }]));
    const catalogs = new Map<string, ApiCatalog | null>();
    for (const key of Object.keys(servers)) catalogs.set(key, await this.getCatalog({ ...scope, serverId: bindings[key] ?? key }));
    const runKey = `${scope.projectId}:${scope.environmentId}`;
    this.assertAvailable(scope.projectId);
    if (this.projectIsActive(scope.projectId)) throw new Error("이 프로젝트에서 이미 실행 중입니다");
    const controller = new AbortController();
    this.active.set(runKey, controller);
    // Results carry raw values; the renderer's "민감값 숨기기" toggle decides visibility.
    const details = new Map<string, { request?: ApiRequestTrace; response?: { headers: Record<string, string>; body: Json } }>();
    let variables: Record<string, Json> = {};
    try {
      const result = await this.runner.run(scenario, {
        projectId: scope.projectId, environment: scope.environmentId, inputs, servers, cookies: this.cookieJar(scope.projectId), signal: controller.signal, runId: options.runId ?? randomUUID(),
        requestInput: async request => options.requestInput?.(request),
        resolveOperation: (server, api) => {
          const matches = catalogs.get(server)?.operations.filter(operation => "operationId" in api ? operation.operationId === api.operationId : operation.method === api.method && operation.path === api.path) ?? [];
          if (matches.length !== 1) throw new Error("API 명세가 변경되었습니다");
          return matches[0];
        },
        onRequest: (request, id) => {
          const detail = details.get(id) ?? {};
          detail.request = request;
          details.set(id, detail);
        },
        onResponse: (response, id) => {
          const detail = details.get(id) ?? {};
          detail.response = response;
          details.set(id, detail);
        },
        onVariables: value => { variables = value; },
      });
      return { status: result.status, variables, steps: result.steps.map(step => {
        const detail = details.get(step.id);
        return {
          ...step,
          ...(detail?.request ? { request: detail.request } : {}),
          ...(detail?.response ? {
            headers: detail.response.headers,
            body: detail.response.body,
          } : {}),
        };
      }) };
    } finally { this.active.delete(runKey); }
  }
  cancel(input: ApiScope) {
    const s = scopeSchema.parse(input);
    this.active.get(`${s.projectId}:${s.environmentId}`)?.abort();
  }
  async execute(input: ApiScope, key: string, request: unknown): Promise<ApiResponse> {
    const { scope, baseUrl, server, environment } = await this.scope(input);
    if (!baseUrl) throw new Error(unsetAddress(server.name, environment.name));
    // Scope is already validated; do not read and validate projects.json twice per request.
    const catalog = await this.readCatalog(scope);
    const operation = catalog?.operations.find(o => o.key === key);
    if (!operation) throw new Error("명세에서 API를 다시 선택하세요");
    if (operation.warnings.length) throw new Error(operation.warnings.join("\n"));
    const scenario = scenarioSchema.parse({ version: 1, id: "single", name: operation.summary, steps: [{ id: "request", name: operation.summary, server: scope.serverId, api: operation.operationId ? { operationId: operation.operationId } : { method: operation.method, path: operation.path }, request }] });
    const req = scenario.steps[0].request;
    // Remember what was typed before any check below can fail; never let storage break the request.
    const remembered = docInputFromRequest(req);
    await this.setDocInput(scope.projectId, `${scope.serverId} ${key}`, remembered).catch(() => undefined);
    const auth = this.requestAuth.get(this.authKey(scope));
    if (auth) {
      if (auth.baseUrl !== baseUrl) throw new Error("서버 주소가 변경되었습니다. API 인증 설정을 다시 연결하거나 해제하세요");
      if (Object.entries(req.headers ?? {}).some(([name, value]) => name.toLowerCase() === "authorization" && value !== "")) throw new Error("개별 Authorization 헤더와 공통 인증이 중복됩니다. 하나를 해제하세요");
      req.headers = { ...Object.fromEntries(Object.entries(req.headers ?? {}).filter(([name]) => name.toLowerCase() !== "authorization")), Authorization: `Bearer ${this.authToken(scope, auth.variable)}` };
    }
    for (const p of operation.parameters.filter(p => p.required && p.location !== "cookie")) {
      const values = p.location === "path" ? req.pathParams : p.location === "query" ? req.query : req.headers;
      const found = Object.entries(values ?? {}).find(([k]) => p.location === "header" ? k.toLowerCase() === p.name.toLowerCase() : k === p.name)?.[1];
      if (found === undefined || found === "") throw new Error(`필수 입력: ${p.name}`);
    }
    const requiredCookies = operation.parameters.filter(p => p.required && p.location === "cookie");
    if (requiredCookies.length) {
      const pathParams = resolve(req.pathParams ?? {}, { inputs: {}, vars: scenario.vars, globals: this.runner.globals.snapshot(scope.projectId) }) as Record<string, Json>;
      const url = resolveRequestUrl(baseUrl, operation.path, pathParams);
      const cookies = { ...this.cookieJar(scope.projectId).forUrl(url), ...req.cookies };
      for (const p of requiredCookies) {
        const found = Object.hasOwn(cookies, p.name) ? cookies[p.name] : undefined;
        if (found === undefined || found === "") throw new Error(`필수 입력: ${p.name}`);
      }
    }
    if (operation.bodyRequired && req.body === undefined) throw new Error("요청 본문이 필요합니다");
    this.assertAvailable(scope.projectId);
    const runKey = `${scope.projectId}:${scope.environmentId}`;
    if (this.projectIsActive(scope.projectId)) throw new Error("이 프로젝트에서 이미 요청을 실행 중입니다");
    const controller = new AbortController();
    this.active.set(runKey, controller);
    let detail: { request?: ApiRequestTrace; response?: { headers: Record<string, string>; body: Json } } | undefined;
    try {
      const result = await this.runner.run(scenario, { projectId: scope.projectId, environment: scope.environmentId, cookies: this.cookieJar(scope.projectId), servers: { [scope.serverId]: { baseUrl } }, signal: controller.signal, resolveOperation: () => operation, onRequest: request => {
        detail = { ...(detail ?? {}), request };
      }, onResponse: response => {
        detail = { ...(detail ?? {}), response };
      } });
      const step = result.steps[0];
      return { status: step.status, httpStatus: step.httpStatus, durationMs: step.durationMs, error: step.error, ...(detail?.request ? { request: detail.request } : {}), ...(detail?.response ? detail.response : {}) };
    } finally { this.active.delete(runKey); }
  }
}

/** A team project may leave a server·environment address unset ("미설정"); calls there say so. */
const unsetAddress = (server: string, environment: string) => `${environment} 환경에 ${server} 서버 주소가 설정되지 않았습니다(미설정). 프로젝트 설정에서 주소를 입력하세요`;

/** Team project as typed in the form; the first problem in words instead of a schema dump. */
function parseTeamProject(input: unknown): ApiProject {
  const parsed = teamProjectSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "프로젝트 설정을 확인하세요");
  return parsed.data;
}

/** The top-level `name:` of a scenario document, readable even when the rest does not parse. */
function aiScenarioName(yaml: string): string | undefined {
  const value = /^name:[ \t]*(.+?)[ \t]*$/m.exec(yaml)?.[1];
  return value?.replace(/^(['"])(.*)\1$/, "$2").trim() || undefined;
}
