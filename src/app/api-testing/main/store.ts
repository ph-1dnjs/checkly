import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { projectSchema, type ApiProject, type SavedApiScenario, type SavedApiSuite } from "../shared/workspace";
import type { ApiDocInput } from "../shared/doc-inputs";

/** Scenarios rewritten because a server they name was renamed: the version read and the new one. */
export type ScenarioRename = { before: SavedApiScenario; after: SavedApiScenario };
export type SpecUrl = { serverId: string; environmentId: string; url: string };
type KeptTitles = NonNullable<SavedApiScenario["keptTitles"]>;

/**
 * Where projects, scenarios, suites and docs inputs are kept: files on this computer (FileStore) or
 * the signed-in team project (TeamStore). Writes given the `updatedAt` the caller read resolve
 * null/false when another save got there first; the workspace words that per action. Lists come back
 * as stored and the workspace parses them. Catalogs, AI files, docs accounts, globals and cookies stay
 * local either way.
 */
export interface ApiStore {
  /** `maxAgeMs`: a copy read this recently may be reused (only the team store keeps one). */
  listProjects(maxAgeMs?: number): Promise<ApiProject[]>;
  /** `previous`: the stored version, absent for a new project. */
  saveProject(project: ApiProject, previous: ApiProject | undefined, renames: ScenarioRename[]): Promise<void>;
  listScenarios(projectId: string): Promise<Record<string, unknown>[]>;
  putScenario(projectId: string, item: SavedApiScenario, expectedUpdatedAt: string | undefined): Promise<SavedApiScenario | null>;
  deleteScenario(projectId: string, id: string, expectedUpdatedAt: string): Promise<boolean>;
  /** Metadata only: the scenario keeps its updatedAt, so an editor open on it can still save. */
  keepTitles(projectId: string, id: string, keptTitles: KeptTitles): Promise<boolean>;
  listSuites(projectId: string): Promise<Record<string, unknown>[]>;
  putSuite(projectId: string, suite: SavedApiSuite, expectedUpdatedAt: string | undefined): Promise<SavedApiSuite | null>;
  deleteSuite(projectId: string, id: string, expectedUpdatedAt: string): Promise<boolean>;
  /** Keyed by "<serverId> <METHOD path>". */
  docInputs(projectId: string): Promise<Record<string, ApiDocInput>>;
  setDocInput(projectId: string, key: string, input: ApiDocInput | undefined): Promise<void>;
  specUrls(project: ApiProject): Promise<SpecUrl[]>;
}

export const docInputsSchema = z.record(z.string(), z.object({
  pathParams: z.record(z.string(), z.json()).optional(), query: z.record(z.string(), z.json()).optional(),
  headers: z.record(z.string(), z.string()).optional(), cookies: z.record(z.string(), z.json()).optional(), body: z.json().optional(),
}));

/** JSON files in one folder, each replaced through a temporary file. Also holds the local-only files in team mode. */
export class FileStore implements ApiStore {
  constructor(readonly directory: string) {}

  async save(file: string, value: unknown) {
    await mkdir(this.directory, { recursive: true });
    const temp = path.join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temp, path.join(this.directory, file));
  }
  async read(file: string): Promise<unknown | null> {
    try { return JSON.parse(await readFile(path.join(this.directory, file), "utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("저장된 API 작업 공간을 읽을 수 없습니다"); }
  }
  async remove(file: string) {
    try { await unlink(path.join(this.directory, file)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }

  async listProjects(): Promise<ApiProject[]> {
    return z.array(projectSchema).parse(await this.read("projects.json") ?? []);
  }
  async saveProject(project: ApiProject, previous: ApiProject | undefined, renames: ScenarioRename[]) {
    const removedServers = previous?.servers.filter(server => !project.servers.some(next => next.id === server.id)) ?? [];
    if (removedServers.length) {
      const inputs = await this.docInputs(project.id);
      await this.save(`doc-inputs-${project.id}.json`, Object.fromEntries(Object.entries(inputs).filter(([key]) => !removedServers.some(server => key.startsWith(`${server.id} `)))));
    }
    const projects = await this.listProjects();
    const index = projects.findIndex(p => p.id === project.id);
    if (index < 0) projects.push(project); else projects[index] = project;
    const scenarioFile = `scenarios-${project.id}.json`;
    const original = renames.length ? await this.listScenarios(project.id) : undefined;
    if (original) await this.save(scenarioFile, original.map(item => renames.find(rename => rename.before.id === item.id)?.after ?? item));
    try { await this.save("projects.json", projects); }
    catch (error) {
      if (original) await this.save(scenarioFile, original);
      throw error;
    }
  }

  async listScenarios(projectId: string) { return await this.read(`scenarios-${projectId}.json`) as Record<string, unknown>[] | null ?? []; }
  async putScenario(projectId: string, item: SavedApiScenario, expectedUpdatedAt: string | undefined) {
    return await this.put(`scenarios-${projectId}.json`, item, expectedUpdatedAt) ? item : null;
  }
  deleteScenario(projectId: string, id: string, expectedUpdatedAt: string) { return this.drop(`scenarios-${projectId}.json`, id, expectedUpdatedAt); }
  async keepTitles(projectId: string, id: string, keptTitles: KeptTitles) {
    const saved = await this.listScenarios(projectId);
    const item = saved.find(candidate => candidate.id === id);
    if (!item) return false;
    item.keptTitles = keptTitles;
    await this.save(`scenarios-${projectId}.json`, saved);
    return true;
  }

  async listSuites(projectId: string) { return await this.read(`suites-${projectId}.json`) as Record<string, unknown>[] | null ?? []; }
  async putSuite(projectId: string, suite: SavedApiSuite, expectedUpdatedAt: string | undefined) {
    return await this.put(`suites-${projectId}.json`, suite, expectedUpdatedAt) ? suite : null;
  }
  deleteSuite(projectId: string, id: string, expectedUpdatedAt: string) { return this.drop(`suites-${projectId}.json`, id, expectedUpdatedAt); }

  async docInputs(projectId: string): Promise<Record<string, ApiDocInput>> {
    const parsed = docInputsSchema.safeParse(await this.read(`doc-inputs-${projectId}.json`));
    return parsed.success ? parsed.data as Record<string, ApiDocInput> : {};
  }
  async setDocInput(projectId: string, key: string, input: ApiDocInput | undefined) {
    const inputs = await this.docInputs(projectId);
    if (input) inputs[key] = input; else delete inputs[key];
    await this.save(`doc-inputs-${projectId}.json`, inputs);
  }

  async specUrls(project: ApiProject): Promise<SpecUrl[]> {
    const urls: SpecUrl[] = [];
    for (const environment of project.environments) for (const server of project.servers) {
      const stored = await this.read(`spec-source-${project.id}-${environment.id}-${server.id}.json`) as { url?: unknown } | null;
      if (typeof stored?.url === "string") urls.push({ serverId: server.id, environmentId: environment.id, url: stored.url });
    }
    return urls;
  }

  /** Adds or replaces one item of a list file; false when the stored one is not the version read. */
  private async put(file: string, item: { id: string }, expectedUpdatedAt: string | undefined) {
    const saved = await this.read(file) as Array<{ id: string; updatedAt?: unknown }> | null ?? [];
    const index = saved.findIndex(candidate => candidate.id === item.id);
    if (index >= 0 && saved[index].updatedAt !== expectedUpdatedAt) return false;
    if (index >= 0) saved[index] = item; else saved.push(item);
    await this.save(file, saved);
    return true;
  }
  private async drop(file: string, id: string, expectedUpdatedAt: string) {
    const saved = await this.read(file) as Array<{ id: string; updatedAt?: unknown }> | null ?? [];
    if (!saved.some(item => item.id === id && item.updatedAt === expectedUpdatedAt)) return false;
    await this.save(file, saved.filter(item => item.id !== id));
    return true;
  }
}
