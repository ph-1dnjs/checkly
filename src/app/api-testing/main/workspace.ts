import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { projectSchema, type ApiCatalog, type ApiProject, type ApiScope, type ApiResponse, type ApiProjectScope, type ApiEnvironmentScope, type ApiGlobal, type SavedApiScenario, type SavedApiSuite, type ApiSidebarMetadata, type ApiScenarioPreview, type ApiScenarioResult, type ApiRequestTrace } from "../shared/workspace";
import { z } from "zod";
import { ApiRunner } from "./execution";
import { bindingUseLocations, pruneUnusedBrokenBindings, stringifyScenario, parseScenario, scenarioSchema, scenarioStepInputs, scenarioStepLabel, type Json, type Scenario, type ScenarioInputRequest } from "../shared/scenario";
import { readOpenApi } from "./openapi";
import { ApiRedactor } from "./redaction";
import { createAiContext } from "./ai-context";

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
export type ApiScenarioRunOptions = {
  runId?: string;
  requestInput?: (request: ScenarioInputRequest) => Promise<Json | undefined>;
};

export class ApiWorkspace {
  private queue: Promise<unknown> = Promise.resolve();
  private runner = new ApiRunner();
  private active = new Map<string, AbortController>();
  private requestAuth = new Map<string, { variable: string; baseUrl: string }>();
  constructor(private directory: string) {}
  private maintenance = new Set<string>();
  private syncing = new Map<string, number>();
  private catalogCache = new Map<string, ApiCatalog | null>();
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
  private async removeFile(file: string) {
    try { await unlink(path.join(this.directory, file)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private async clearScope(scope: ApiScope) {
    await this.removeFile(this.filename(scope));
    await this.removeFile(`spec-source-${scope.projectId}-${scope.environmentId}-${scope.serverId}.json`);
    this.requestAuth.delete(this.authKey(scope));
    this.catalogCache.delete(this.filename(scope));
  }
  async deleteProject(rawId: string): Promise<void> {
    const id = z.string().uuid().parse(rawId);
    return this.mutate(id, async () => {
      const projects = await this.listProjects();
      const project = projects.find(p => p.id === id);
      if (!project) throw new Error("프로젝트를 찾을 수 없습니다");
      for (const env of project.environments) {
        for (const server of project.servers) await this.clearScope({ projectId: id, environmentId: env.id, serverId: server.id });
      }
      this.runner.globals.clear(id);
      await this.removeFile(`scenarios-${id}.json`);
      await this.removeFile(`suites-${id}.json`);
      await this.save("projects.json", projects.filter(p => p.id !== id));
    });
  }
  async deleteCatalog(input: ApiScope): Promise<void> {
    const scope = scopeSchema.parse(input);
    return this.mutate(scope.projectId, async () => {
      const project = (await this.listProjects()).find(p => p.id === scope.projectId);
      if (!project?.servers.some(s => s.id === scope.serverId) || !project.environments.some(e => e.id === scope.environmentId)) throw new Error("프로젝트·서버·환경을 선택하세요");
      await this.clearScope(scope);
    });
  }
  async deleteScenario(rawProjectId: string, rawId: string, revision: string): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const id = z.string().min(1).max(1000).parse(rawId);
    return this.mutate(projectId, async () => {
      const saved = await this.listScenarios(projectId);
      const item = saved.find(s => s.id === id);
      if (!item || item.updatedAt !== revision) throw new Error("시나리오가 변경되었습니다. 최신 목록에서 다시 선택하세요");
      await this.save(`scenarios-${projectId}.json`, saved.filter(s => s.id !== id));
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

  async buildAiContext(raw: unknown): Promise<string> {
    const request = z.object({
      scope: environmentScopeSchema,
      selections: z.array(z.object({ serverId: z.string().uuid(), operationKey: z.string().max(1000) }).strict()).min(1).max(100),
      goal: z.string().max(10_000),
    }).strict().parse(raw);
    const { scope, project } = await this.environment(request.scope);
    const selected = [];
    const seen = new Set<string>();
    for (const selection of request.selections) {
      const key = JSON.stringify(selection);
      if (seen.has(key)) continue;
      seen.add(key);
      const server = project.servers.find(s => s.id === selection.serverId);
      const operation = (await this.getCatalog({ ...scope, serverId: selection.serverId }))?.operations.find(o => o.key === selection.operationKey);
      if (!server || !operation) throw new Error("선택한 API가 현재 프로젝트·환경의 명세에 없습니다");
      if (operation.warnings.length) throw new Error("현재 실행을 지원하는 API만 선택하세요");
      selected.push({ server: server.id, serverName: server.name, operation });
    }
    const redactor = new ApiRedactor();
    redactor.add(this.runner.globals.snapshot(scope.projectId));
    selected.forEach(({ operation }) => redactor.discover(operation.bodyExample));
    const output = redactor.mask(createAiContext(request.goal, selected, await this.listGlobals({ projectId: scope.projectId }))) as string;
    if (Buffer.byteLength(output) > 500_000) throw new Error("선택 정보가 너무 큽니다. API 수를 줄이세요");
    return output;
  }

  private async save(file: string, value: unknown) {
    await mkdir(this.directory, { recursive: true });
    const temp = path.join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temp, path.join(this.directory, file));
  }
  private async read(file: string): Promise<unknown | null> {
    try { return JSON.parse(await readFile(path.join(this.directory, file), "utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("저장된 API 작업 공간을 읽을 수 없습니다"); }
  }
  async listProjects(): Promise<ApiProject[]> {
    return z.array(projectSchema).parse(await this.read("projects.json") ?? []);
  }
  async saveProject(input: unknown): Promise<ApiProject> {
    const project = projectSchema.parse(input);
    return this.mutate(project.id, async () => {
      const projects = await this.listProjects();
      const index = projects.findIndex(p => p.id === project.id);
      let originalScenarios: SavedApiScenario[] | undefined;
      let renamedScenarios: SavedApiScenario[] | undefined;
      if (index >= 0) {
        const previous = projects[index];
        if (previous.servers.some(old => project.servers.some(next => next.id === old.id && next.name !== old.name))) {
          originalScenarios = await this.listScenarios(project.id);
          renamedScenarios = originalScenarios.map(item => {
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
            return changed ? { ...item, source: stringifyScenario({ ...scenario, steps }, true), bindings: {}, updatedAt: new Date(Math.max(Date.now(), Date.parse(item.updatedAt) + 1)).toISOString() } : item;
          });
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
      if (index < 0) projects.push(project); else projects[index] = project;
      if (renamedScenarios) await this.save(`scenarios-${project.id}.json`, renamedScenarios);
      try { await this.save("projects.json", projects); }
      catch (error) {
        if (originalScenarios) await this.save(`scenarios-${project.id}.json`, originalScenarios);
        throw error;
      }
      return project;
    });
  }
  private async scope(input: ApiScope) {
    const s = scopeSchema.parse(input);
    const project = (await this.listProjects()).find(p => p.id === s.projectId);
    this.assertAvailable(s.projectId);
    const environment = project?.environments.find(e => e.id === s.environmentId);
    if (!environment || !project?.servers.some(v => v.id === s.serverId)) throw new Error("프로젝트·서버·환경을 선택하세요");
    return { scope: s, baseUrl: environment.baseUrls[s.serverId] };
  }
  private filename(s: ApiScope) { return `catalog-${s.projectId}-${s.environmentId}-${s.serverId}.json`; }
  private async readCatalog(scope: ApiScope): Promise<ApiCatalog | null> {
    const filename = this.filename(scope);
    if (this.catalogCache.has(filename)) return this.catalogCache.get(filename)!;
    const catalog = await this.read(filename) as ApiCatalog | null;
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
      const catalog = readOpenApi(source);
      await this.save(this.filename(scope), catalog);
      this.catalogCache.set(this.filename(scope), catalog);
      return catalog;
    } finally { release(); }
  }

  private async environment(input: ApiEnvironmentScope) {
    const scope = environmentScopeSchema.parse(input);
    const project = (await this.listProjects()).find(p => p.id === scope.projectId);
    this.assertAvailable(scope.projectId);
    const environment = project?.environments.find(e => e.id === scope.environmentId);
    if (!project || !environment) throw new Error("프로젝트·환경을 선택하세요");
    return { scope, project, environment };
  }

  private async project(input: ApiProjectScope) {
    const scope = projectScopeSchema.parse(input);
    const project = (await this.listProjects()).find(p => p.id === scope.projectId);
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

  async listScenarios(rawProjectId: string): Promise<SavedApiScenario[]> {
    const projectId = z.string().uuid().parse(rawProjectId);
    if (!(await this.listProjects()).some(p => p.id === projectId)) throw new Error("프로젝트를 찾을 수 없습니다");
    const saved = await this.read(`scenarios-${projectId}.json`) as Record<string, unknown>[] | undefined;
    return (saved ?? []).map(item => migrateSidebarMetadata(item) as unknown as SavedApiScenario);
  }

  async listSuites(rawProjectId: string): Promise<SavedApiSuite[]> {
    const projectId = z.string().uuid().parse(rawProjectId);
    if (!(await this.listProjects()).some(project => project.id === projectId)) throw new Error("프로젝트를 찾을 수 없습니다");
    const saved = await this.read(`suites-${projectId}.json`) as Record<string, unknown>[] | undefined;
    return z.array(suiteSchema.extend({ updatedAt: z.string().datetime() })).parse((saved ?? []).map(migrateSidebarMetadata));
  }

  async saveSuite(rawProjectId: string, rawSuite: Omit<SavedApiSuite, "updatedAt">, expectedUpdatedAt?: string): Promise<SavedApiSuite> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const suite = suiteSchema.parse(rawSuite);
    const action = this.queue.then(async () => {
      const scenarios = await this.listScenarios(projectId);
      if (suite.scenarioIds.some(id => !scenarios.some(item => item.id === id && !item.draft))) throw new Error("저장된 실행 가능 시나리오만 묶음에 추가하세요");
      const saved = await this.listSuites(projectId);
      const index = saved.findIndex(item => item.id === suite.id);
      if (index >= 0 && saved[index].updatedAt !== expectedUpdatedAt) throw new Error("묶음이 변경되었습니다. 최신 목록에서 다시 선택하세요");
      const item: SavedApiSuite = { ...suite, updatedAt: new Date(Math.max(Date.now(), index >= 0 ? Date.parse(saved[index].updatedAt) + 1 : 0)).toISOString() };
      if (index >= 0) saved[index] = item; else saved.push(item);
      await this.save(`suites-${projectId}.json`, saved);
      return item;
    });
    this.queue = action.catch(() => undefined);
    return action;
  }

  async deleteSuite(rawProjectId: string, rawId: string, expectedUpdatedAt: string): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const id = z.string().uuid().parse(rawId);
    const action = this.queue.then(async () => {
      const saved = await this.listSuites(projectId);
      const item = saved.find(suite => suite.id === id);
      if (!item || item.updatedAt !== expectedUpdatedAt) throw new Error("묶음이 변경되었습니다. 최신 목록에서 다시 선택하세요");
      await this.save(`suites-${projectId}.json`, saved.filter(suite => suite.id !== id));
    });
    this.queue = action.catch(() => undefined);
    return action;
  }

  private parseSource(source: string): Scenario {
    if (typeof source !== "string" || Buffer.byteLength(source) > 1_000_000) throw new Error("시나리오 YAML은 1MB 이하로 입력하세요");
    try { return pruneUnusedBrokenBindings(parseScenario(source)); }
    catch (e) {
      if (e instanceof z.ZodError) throw new Error(e.issues.map(i => `${i.path.join(".") || "시나리오"}: ${i.message}`).join("\n"));
      throw new Error("YAML 문법이 올바르지 않습니다. 들여쓰기와 중복 키를 확인하세요");
    }
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
        if (!availableGlobals.has(variable)) executionIssues.push(`${executionLabel}: 인증 전역변수 '${variable}' 값이 없습니다. 전역 변수에서 설정하세요`);
        else {
          const token = this.runner.globals.snapshot(scope.projectId)[variable];
          if (typeof token !== "string" || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) executionIssues.push(`${executionLabel}: 인증 전역변수 '${variable}'는 Bearer 접두사 없는 토큰 문자열이어야 합니다`);
        }
      }
      for (const binding of scenario.valueBindings) {
        const sourceIndex = stepIndexes.get(binding.step);
        if (sourceIndex !== undefined && sourceIndex < index) variables.add(binding.name);
      }
      const serverId = bindings[step.server] ?? step.server;
      if (!environment.baseUrls[serverId]) executionIssues.push(`${executionLabel}: 서버 기본 URL을 환경 설정에서 지정하세요`);
      if (!project.servers.some(s => s.id === serverId)) issues.push(`${stepName}: 서버 '${step.server}'를 연결하세요`);
      else {
        if (!catalogs.has(serverId)) catalogs.set(serverId, await this.getCatalog({ ...scope, serverId }));
        const api = step.api;
        const matches = catalogs.get(serverId)?.operations.filter(o => "operationId" in api ? o.operationId === api.operationId : o.method === api.method && o.path === api.path) ?? [];
        if (matches.length !== 1) issues.push(`${stepName}: 현재 환경의 명세에서 API를 유일하게 찾을 수 없습니다`);
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
            if (!availableGlobals.has(match[1])) executionIssues.push(`${executionLabel}: 전역변수 '${match[1]}' 값이 없습니다. 전역 변수에서 설정하세요`);
          }
          for (const match of v.matchAll(/\{\{(vars|inputs)\.([A-Za-z][A-Za-z0-9_]*)\}\}/g)) {
            const declaredByBinding = match[1] === "vars" && bindingNames.has(match[2]);
            if (match[1] === "vars" ? !variables.has(match[2]) && !declaredByBinding : !Object.hasOwn(scenario.inputs, match[2])) issues.push(`${stepName}: ${match[1]}.${match[2]}는 이 단계 전에 정의되지 않았습니다`);
          }
        } else if (v && typeof v === "object") Object.values(v).forEach(check);
      };
      check(step.request); check(step.expect);
      step.extract.filter(e => e.target.startsWith("globals.")).forEach(e => availableGlobals.add(e.target.slice(8)));
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

  private async persistScenario(input: ApiEnvironmentScope, source: string, bindings: Record<string, string>, expectedUpdatedAt: string | undefined, draft: boolean, rawMetadata?: ApiSidebarMetadata): Promise<SavedApiScenario> {
    const preview = await this.previewScenario(input, source, bindings);
    if (!draft && preview.issues.length) throw new Error(preview.issues.join("\n"));
    if (parseScenario(source).valueBindings.length !== preview.scenario.valueBindings.length) source = stringifyScenario(preview.scenario, true);
    const metadata = rawMetadata === undefined ? undefined : sidebarMetadataSchema.parse(rawMetadata);
    const action = this.queue.then(async () => {
      const { project } = await this.environment(input);
      const saved = await this.listScenarios(input.projectId);
      const index = saved.findIndex(s => s.id === preview.scenario.id);
      if (index >= 0 && saved[index].updatedAt !== expectedUpdatedAt) throw new Error("같은 ID의 시나리오가 있습니다. 목록에서 최신 시나리오를 열어 수정하세요");
      const named = { ...preview.scenario, steps: preview.scenario.steps.map(step => ({ ...step, server: project.servers.find(server => server.id === step.server)?.name ?? step.server })) };
      const previous = index >= 0 ? saved[index] : undefined;
      const item: SavedApiScenario = {
        id: preview.scenario.id, name: preview.scenario.name, source: stringifyScenario(named, true), bindings: {}, updatedAt: new Date().toISOString(), draft,
        ...(metadata?.groupPath !== undefined ? { groupPath: metadata.groupPath } : metadata === undefined && previous?.groupPath ? { groupPath: previous.groupPath } : {}),
        ...(metadata?.tags !== undefined ? { tags: metadata.tags } : previous?.tags ? { tags: previous.tags } : {}),
      };
      if (index >= 0) saved[index] = item; else saved.push(item);
      await this.save(`scenarios-${input.projectId}.json`, saved);
      return item;
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
        projectId: scope.projectId, environment: scope.environmentId, inputs, servers, signal: controller.signal, runId: options.runId ?? randomUUID(),
        requestInput: async request => options.requestInput?.(request),
        resolveOperation: (server, operationId) => {
          const operation = catalogs.get(server)?.operations.find(o => o.operationId === operationId);
          if (!operation) throw new Error("API 명세가 변경되었습니다");
          return operation;
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
    return this.executeRequest(input, key, request);
  }
  /** Same raw contract as execute; kept as the Swagger "Try it out" entry point. */
  async executeLive(input: ApiScope, key: string, request: unknown): Promise<ApiResponse> {
    return this.executeRequest(input, key, request);
  }
  private async executeRequest(input: ApiScope, key: string, request: unknown): Promise<ApiResponse> {
    const { scope, baseUrl } = await this.scope(input);
    // Scope is already validated; do not read and validate projects.json twice per request.
    const catalog = await this.readCatalog(scope);
    const operation = catalog?.operations.find(o => o.key === key);
    if (!operation) throw new Error("명세에서 API를 다시 선택하세요");
    if (operation.warnings.length) throw new Error(operation.warnings.join("\n"));
    const scenario = scenarioSchema.parse({ version: 1, id: "single", name: operation.summary, steps: [{ id: "request", name: operation.summary, server: scope.serverId, api: operation.operationId ? { operationId: operation.operationId } : { method: operation.method, path: operation.path }, request }] });
    const req = scenario.steps[0].request;
    const auth = this.requestAuth.get(this.authKey(scope));
    if (auth) {
      if (auth.baseUrl !== baseUrl) throw new Error("서버 주소가 변경되었습니다. API 인증 설정을 다시 연결하거나 해제하세요");
      if (Object.entries(req.headers ?? {}).some(([name, value]) => name.toLowerCase() === "authorization" && value !== "")) throw new Error("개별 Authorization 헤더와 공통 인증이 중복됩니다. 하나를 해제하세요");
      req.headers = { ...Object.fromEntries(Object.entries(req.headers ?? {}).filter(([name]) => name.toLowerCase() !== "authorization")), Authorization: `Bearer ${this.authToken(scope, auth.variable)}` };
    }
    for (const p of operation.parameters.filter(p => p.required)) {
      const values = p.location === "path" ? req.pathParams : p.location === "query" ? req.query : p.location === "cookie" ? req.cookies : req.headers;
      const found = Object.entries(values ?? {}).find(([k]) => p.location === "header" ? k.toLowerCase() === p.name.toLowerCase() : k === p.name)?.[1];
      if (found === undefined || found === "") throw new Error(`필수 입력: ${p.name}`);
    }
    if (operation.bodyRequired && req.body === undefined) throw new Error("요청 본문이 필요합니다");
    this.assertAvailable(scope.projectId);
    const runKey = `${scope.projectId}:${scope.environmentId}`;
    if (this.projectIsActive(scope.projectId)) throw new Error("이 프로젝트에서 이미 요청을 실행 중입니다");
    const controller = new AbortController();
    this.active.set(runKey, controller);
    let detail: { request?: ApiRequestTrace; response?: { headers: Record<string, string>; body: Json } } | undefined;
    try {
      const result = await this.runner.run(scenario, { projectId: scope.projectId, environment: scope.environmentId, servers: { [scope.serverId]: { baseUrl } }, signal: controller.signal, resolveOperation: () => operation, onRequest: request => {
        detail = { ...(detail ?? {}), request };
      }, onResponse: response => {
        detail = { ...(detail ?? {}), response };
      } });
      const step = result.steps[0];
      return { status: step.status, httpStatus: step.httpStatus, durationMs: step.durationMs, error: step.error, ...(detail?.request ? { request: detail.request } : {}), ...(detail?.response ? detail.response : {}) };
    } finally { this.active.delete(runKey); }
  }
}
