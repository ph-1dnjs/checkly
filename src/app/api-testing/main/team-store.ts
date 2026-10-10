import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MESSAGES, toUserMessage } from "../../ipc/auth/errors";
import type { ApiAuthorship, ApiProject, SavedApiScenario, SavedApiSuite } from "../shared/workspace";
import type { ApiDocInput } from "../shared/doc-inputs";
import type { ApiStore, ScenarioRename, SpecUrl } from "./store";

/** The signed-in member's team project. Its API testing project has the same id and the project code as name. */
export type ApiTeamContext = { client: SupabaseClient; userId: string; projectId: string; projectCode: string };

type EndpointRow = { id: string; name: string; kind: "web" | "api"; position: number; updated_at: string | null };
type EnvironmentRow = { id: string; name: string; position: number; updated_at: string | null };
type UrlRow = { endpoint_id: string; environment_id: string; base_url: string; spec_url: string | null; updated_at: string | null };
type Settings = { endpoints: EndpointRow[]; environments: EnvironmentRow[]; urls: UrlRow[] };
/** Stamped by the database: created_* on insert (kept on update), updated_* on every content change. */
type AuthorshipRow = { created_at: string; created_by: string | null; updated_by: string | null };
type ScenarioRow = AuthorshipRow & { id: string; name: string; source: string; draft: boolean; group_path: string[] | null; tags: string[] | null; kept_titles: SavedApiScenario["keptTitles"] | null; updated_at: string };
/** A spec doc's Basic-auth account shared with the team (only while secrets are shared). */
export type TeamSpecAccount = { url: string; username: string; password: string };
type SuiteRow = AuthorshipRow & { id: string; name: string; scenario_ids: string[]; on_failure: "stop" | "continue"; group_path: string[] | null; tags: string[] | null; updated_at: string };

const authorshipColumns = "created_at, created_by, updated_by";
const scenarioColumns = `id, name, source, draft, group_path, tags, kept_titles, updated_at, ${authorshipColumns}`;
const suiteColumns = `id, name, scenario_ids, on_failure, group_path, tags, updated_at, ${authorshipColumns}`;
/** Shown for a creator or editor who is no longer a member of the project. */
export const LEFT_MEMBER = "(나간 멤버)";
/** null: the member list could not be read, so names are left out rather than shown as left. */
type Names = Map<string, string> | null;

/** Supabase answers { data, error }; errors become the same Korean sentences as the rest of the team features. */
async function must<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(toUserMessage(error));
  return data as T;
}

/** Member nicknames for the stamped user ids; a user id no longer among the members reads LEFT_MEMBER, none (unknown) is left out. */
const fromAuthorshipRow = (row: AuthorshipRow, names: Names): ApiAuthorship => {
  const name = (id: string | null) => id === null || !names ? undefined : names.get(id) ?? LEFT_MEMBER;
  const createdBy = name(row.created_by), updatedBy = name(row.updated_by);
  return { createdAt: row.created_at, ...(createdBy ? { createdBy } : {}), ...(updatedBy ? { updatedBy } : {}) };
};
const fromScenarioRow = (row: ScenarioRow, names: Names): SavedApiScenario => ({
  id: row.id, name: row.name, source: row.source, bindings: {}, updatedAt: row.updated_at, draft: row.draft,
  ...(row.group_path ? { groupPath: row.group_path } : {}), ...(row.tags ? { tags: row.tags } : {}), ...(row.kept_titles ? { keptTitles: row.kept_titles } : {}),
  ...fromAuthorshipRow(row, names),
});
// created_* are never sent: the database stamps them.
const scenarioRow = (item: SavedApiScenario) => ({ id: item.id, name: item.name, source: item.source, draft: item.draft ?? false, group_path: item.groupPath ?? null, tags: item.tags ?? null, kept_titles: item.keptTitles ?? null });
const fromSuiteRow = (row: SuiteRow, names: Names): SavedApiSuite => ({
  id: row.id, name: row.name, scenarioIds: row.scenario_ids, onFailure: row.on_failure, updatedAt: row.updated_at,
  ...(row.group_path ? { groupPath: row.group_path } : {}), ...(row.tags ? { tags: row.tags } : {}), ...fromAuthorshipRow(row, names),
});
const suiteRow = (suite: SavedApiSuite) => ({ id: suite.id, name: suite.name, scenario_ids: suite.scenarioIds, on_failure: suite.onFailure, group_path: suite.groupPath ?? null, tags: suite.tags ?? null });
/** "<serverId> <METHOD path>" ⇄ (endpoint_id, operation). */
const splitDocKey = (key: string) => { const space = key.indexOf(" "); return { endpoint_id: key.slice(0, space), operation: key.slice(space + 1) }; };

/**
 * API testing data of the signed-in team project in Supabase (RLS keeps it to that project).
 * Servers are the `api` endpoints, environments are all of the project's, base and spec URLs are
 * `endpoint_urls`; `web` endpoints are kept as they are. A pair without an address is allowed here
 * ("미설정") and the workspace reports it where it matters. Updates are conditional on the
 * `updated_at` the caller read: 0 rows means someone else saved first.
 */
export class TeamStore implements ApiStore {
  private snapshot?: { at: number; value: Promise<{ settings: Settings; project: ApiProject }> };
  constructor(readonly context: ApiTeamContext) {}
  private get db() { return this.context.client; }
  private get projectId() { return this.context.projectId; }

  private async readSettings(): Promise<Settings> {
    const [endpoints, environments, urls] = await Promise.all([
      must<EndpointRow[]>(this.db.from("endpoints").select("id, name, kind, position, updated_at").eq("project_id", this.projectId).order("position").order("name")),
      must<EnvironmentRow[]>(this.db.from("environments").select("id, name, position, updated_at").eq("project_id", this.projectId).order("position").order("name")),
      must<UrlRow[]>(this.db.from("endpoint_urls").select("endpoint_id, environment_id, base_url, spec_url, updated_at").eq("project_id", this.projectId)),
    ]);
    return { endpoints, environments, urls };
  }

  /** The project as API testing sees it; `revision` covers exactly what it shows, so web-only edits never conflict. */
  private toProject(settings: Settings): ApiProject {
    const servers = settings.endpoints.filter(endpoint => endpoint.kind === "api").map(({ id, name }) => ({ id, name }));
    const environments = settings.environments.map(({ id, name }) => ({ id, name, baseUrls: Object.fromEntries(servers.flatMap(server => {
      const url = settings.urls.find(candidate => candidate.endpoint_id === server.id && candidate.environment_id === id);
      return url ? [[server.id, url.base_url]] : [];
    })) }));
    const revision = createHash("sha256").update(JSON.stringify([servers, environments])).digest("hex").slice(0, 32);
    return { id: this.projectId, name: this.context.projectCode, revision, servers, environments };
  }

  private current(maxAgeMs: number) {
    if (!this.snapshot || Date.now() - this.snapshot.at > maxAgeMs) {
      const value = this.readSettings().then(settings => ({ settings, project: this.toProject(settings) }));
      this.snapshot = { at: Date.now(), value };
      value.catch(() => { if (this.snapshot?.value === value) this.snapshot = undefined; });
    }
    return this.snapshot.value;
  }

  /** May have no servers or environments yet (only web endpoints, or nothing set up). */
  async listProjects(maxAgeMs = 0): Promise<ApiProject[]> {
    return [structuredClone((await this.current(maxAgeMs)).project)];
  }

  /**
   * Saves servers·environments·addresses through save_project_settings (one transaction, shared
   * with the settings screen): web endpoints and their addresses go back as read, spec URLs stay.
   */
  async saveProject(project: ApiProject, _previous: ApiProject | undefined, renames: ScenarioRename[]) {
    if (project.id !== this.projectId) throw new Error("팀 프로젝트에 로그인한 동안에는 API 프로젝트를 새로 만들 수 없습니다");
    this.snapshot = undefined;
    const known = await this.readSettings();
    if (project.revision !== this.toProject(known).revision) throw new Error(MESSAGES.conflict);
    let endpointPosition = Math.max(-1, ...known.endpoints.map(row => row.position)) + 1;
    let environmentPosition = Math.max(-1, ...known.environments.map(row => row.position)) + 1;
    const endpoints: EndpointRow[] = [
      ...known.endpoints.filter(row => row.kind === "web"),
      ...project.servers.map(server => {
        const row = known.endpoints.find(candidate => candidate.id === server.id && candidate.kind === "api");
        return row ? { ...row, name: server.name } : { id: server.id, name: server.name, kind: "api" as const, position: endpointPosition++, updated_at: null };
      }),
    ];
    const environments: EnvironmentRow[] = project.environments.map(environment => {
      const row = known.environments.find(candidate => candidate.id === environment.id);
      return row ? { ...row, name: environment.name } : { id: environment.id, name: environment.name, position: environmentPosition++, updated_at: null };
    });
    const urls: UrlRow[] = [
      ...known.urls.filter(row => known.endpoints.some(endpoint => endpoint.id === row.endpoint_id && endpoint.kind === "web") && environments.some(environment => environment.id === row.environment_id)),
      ...project.environments.flatMap(environment => project.servers.flatMap(server => {
        const baseUrl = environment.baseUrls[server.id];
        if (!baseUrl) return [];
        const row = known.urls.find(candidate => candidate.endpoint_id === server.id && candidate.environment_id === environment.id);
        return [row ? { ...row, base_url: baseUrl } : { endpoint_id: server.id, environment_id: environment.id, base_url: baseUrl, spec_url: null, updated_at: null }];
      })),
    ];
    const deleted = {
      endpoints: known.endpoints.filter(row => !endpoints.some(next => next.id === row.id)),
      environments: known.environments.filter(row => !environments.some(next => next.id === row.id)),
      urls: known.urls.filter(row => !urls.some(next => next.endpoint_id === row.endpoint_id && next.environment_id === row.environment_id)),
    };
    await must(this.db.rpc("save_project_settings", { p: { endpoints, environments, urls, deleted } }));
    this.snapshot = undefined;
    // After the servers: a scenario edited meanwhile keeps the old name and shows it as a server to connect.
    for (const { before, after } of renames) {
      await must(this.db.from("api_scenarios").update(scenarioRow(after)).eq("project_id", this.projectId).eq("id", before.id).eq("updated_at", before.updatedAt));
    }
  }

  async listScenarios() {
    const rows = await must<ScenarioRow[]>(this.db.from("api_scenarios").select(scenarioColumns).eq("project_id", this.projectId).order("created_at").order("id"));
    const names = await this.names(rows);
    return rows.map(row => fromScenarioRow(row, names));
  }
  async putScenario(_projectId: string, item: SavedApiScenario, expectedUpdatedAt: string | undefined) {
    const row = await this.put<ScenarioRow>("api_scenarios", scenarioColumns, item.id, scenarioRow(item), expectedUpdatedAt);
    return row && fromScenarioRow(row, await this.names([row]));
  }
  deleteScenario(_projectId: string, id: string, expectedUpdatedAt: string) { return this.drop("api_scenarios", id, expectedUpdatedAt); }
  async keepTitles(_projectId: string, id: string, keptTitles: NonNullable<SavedApiScenario["keptTitles"]>) {
    // The trigger only stamps updated_at for content columns, so this leaves the version as it was.
    return (await must<unknown[]>(this.db.from("api_scenarios").update({ kept_titles: keptTitles }).eq("project_id", this.projectId).eq("id", id).select("id"))).length > 0;
  }

  async listSuites() {
    const rows = await must<SuiteRow[]>(this.db.from("api_suites").select(suiteColumns).eq("project_id", this.projectId).order("created_at").order("id"));
    const names = await this.names(rows);
    return rows.map(row => fromSuiteRow(row, names));
  }
  async putSuite(_projectId: string, suite: SavedApiSuite, expectedUpdatedAt: string | undefined) {
    const row = await this.put<SuiteRow>("api_suites", suiteColumns, suite.id, suiteRow(suite), expectedUpdatedAt);
    return row && fromSuiteRow(row, await this.names([row]));
  }
  deleteSuite(_projectId: string, id: string, expectedUpdatedAt: string) { return this.drop("api_suites", id, expectedUpdatedAt); }

  async docInputs(): Promise<Record<string, ApiDocInput>> {
    const rows = await must<Array<{ endpoint_id: string; operation: string; input: ApiDocInput }>>(this.db.from("api_doc_inputs").select("endpoint_id, operation, input").eq("project_id", this.projectId));
    return Object.fromEntries(rows.map(row => [`${row.endpoint_id} ${row.operation}`, row.input]));
  }
  async setDocInput(_projectId: string, key: string, input: ApiDocInput | undefined) {
    const { endpoint_id, operation } = splitDocKey(key);
    if (input) await must(this.db.from("api_doc_inputs").upsert({ project_id: this.projectId, endpoint_id, operation, input }, { onConflict: "endpoint_id,operation" }));
    else await must(this.db.from("api_doc_inputs").delete().eq("project_id", this.projectId).eq("endpoint_id", endpoint_id).eq("operation", operation));
  }

  async specUrls(project: ApiProject): Promise<SpecUrl[]> {
    const rows = await must<UrlRow[]>(this.db.from("endpoint_urls").select("endpoint_id, environment_id, spec_url").eq("project_id", this.projectId).not("spec_url", "is", null));
    return rows.filter(row => project.servers.some(server => server.id === row.endpoint_id) && project.environments.some(environment => environment.id === row.environment_id))
      .map(row => ({ serverId: row.endpoint_id, environmentId: row.environment_id, url: row.spec_url! }));
  }

  /** The team's spec URL of one server·environment; null when none is set. */
  async specUrl(environmentId: string, serverId: string): Promise<string | null> {
    const rows = await must<Array<{ spec_url: string | null }>>(this.db.from("endpoint_urls").select("spec_url").eq("project_id", this.projectId).eq("endpoint_id", serverId).eq("environment_id", environmentId));
    return rows[0]?.spec_url ?? null;
  }
  /** Shares a spec URL with the team. False when the pair has no base address yet (the row is created with one). */
  async setSpecUrl(environmentId: string, serverId: string, url: string): Promise<boolean> {
    const rows = await must<Array<{ spec_url: string | null }>>(this.db.from("endpoint_urls").select("spec_url").eq("project_id", this.projectId).eq("endpoint_id", serverId).eq("environment_id", environmentId));
    if (!rows.length) return false;
    if (rows[0].spec_url !== url) await must(this.db.from("endpoint_urls").update({ spec_url: url }).eq("project_id", this.projectId).eq("endpoint_id", serverId).eq("environment_id", environmentId));
    return true;
  }

  private members?: { at: number; value: Promise<Map<string, string>> };
  /** Member user id → nickname, for "who made / changed it" (a list read in the last 10 seconds is reused). */
  nicknames(): Promise<Map<string, string>> {
    if (!this.members || Date.now() - this.members.at > 10_000) {
      const value = must<Array<{ user_id: string; nickname: string }>>(this.db.from("members").select("user_id, nickname").eq("project_id", this.projectId))
        .then(rows => new Map(rows.map(row => [row.user_id, row.nickname])));
      this.members = { at: Date.now(), value };
      value.catch(() => { if (this.members?.value === value) this.members = undefined; });
    }
    return this.members.value;
  }

  /**
   * Nicknames for these rows, from the session's member list. An id not in it (someone who joined
   * since) reads the list again once; a failed read leaves names out ("(나간 멤버)" would be wrong).
   */
  private async names(rows: AuthorshipRow[]): Promise<Names> {
    const ids = rows.flatMap(row => [row.created_by, row.updated_by]).filter((id): id is string => id !== null);
    if (!ids.length) return new Map();
    try {
      const names = await this.nicknames();
      if (ids.every(id => names.has(id)) || Date.now() - this.members!.at < 1_000) return names;
      this.members = undefined;
      return await this.nicknames();
    } catch { return null; }
  }

  /** "비밀값도 팀에 공유": on unless someone turned it off (no row = the default, on). */
  async settings(): Promise<{ shareSecrets: boolean; updatedAt?: string; updatedBy?: string | null }> {
    const rows = await must<Array<{ share_secrets: boolean; updated_at: string; updated_by: string | null }>>(this.db.from("api_settings").select("share_secrets, updated_at, updated_by").eq("project_id", this.projectId));
    return rows[0] ? { shareSecrets: rows[0].share_secrets, updatedAt: rows[0].updated_at, updatedBy: rows[0].updated_by } : { shareSecrets: true };
  }
  async sharesSecrets(): Promise<boolean> { return (await this.settings()).shareSecrets; }
  async setShareSecrets(on: boolean): Promise<void> {
    await must(this.db.from("api_settings").upsert({ project_id: this.projectId, share_secrets: on }, { onConflict: "project_id" }));
  }

  async specAccount(environmentId: string, serverId: string): Promise<TeamSpecAccount | null> {
    const rows = await must<Array<{ spec_url: string; username: string; password: string }>>(this.db.from("api_spec_accounts").select("spec_url, username, password").eq("project_id", this.projectId).eq("endpoint_id", serverId).eq("environment_id", environmentId));
    return rows[0] ? { url: rows[0].spec_url, username: rows[0].username, password: rows[0].password } : null;
  }
  /** Refused by the database while secrets are not shared. */
  async setSpecAccount(environmentId: string, serverId: string, account: TeamSpecAccount): Promise<void> {
    await must(this.db.from("api_spec_accounts").upsert({ project_id: this.projectId, endpoint_id: serverId, environment_id: environmentId, spec_url: account.url, username: account.username, password: account.password }, { onConflict: "endpoint_id,environment_id" }));
  }
  /** One pair, or every account of the project without arguments. */
  async deleteSpecAccounts(environmentId?: string, serverId?: string): Promise<void> {
    let query = this.db.from("api_spec_accounts").delete().eq("project_id", this.projectId);
    if (environmentId && serverId) query = query.eq("endpoint_id", serverId).eq("environment_id", environmentId);
    await must(query);
  }

  async counts(): Promise<{ scenarios: number; suites: number }> {
    const count = async (table: string) => {
      const { count, error } = await this.db.from(table).select("id", { count: "exact", head: true }).eq("project_id", this.projectId);
      if (error) throw new Error(toUserMessage(error));
      return count ?? 0;
    };
    const [scenarios, suites] = await Promise.all([count("api_scenarios"), count("api_suites")]);
    return { scenarios, suites };
  }

  /** Adds what is not there yet (same id) and leaves existing items alone; resolves to how many were added. */
  async addScenarios(items: SavedApiScenario[]) { return this.addMissing("api_scenarios", items.map(scenarioRow)); }
  async addSuites(suites: SavedApiSuite[]) { return this.addMissing("api_suites", suites.map(suiteRow)); }
  async addDocInputs(inputs: Record<string, ApiDocInput>) {
    const rows = Object.entries(inputs).map(([key, input]) => ({ project_id: this.projectId, ...splitDocKey(key), input }));
    if (rows.length) await must(this.db.from("api_doc_inputs").upsert(rows, { onConflict: "endpoint_id,operation", ignoreDuplicates: true }));
  }

  /** Update when the row is still the version read; otherwise insert, which fails on an existing id (conflict). */
  private async put<T>(table: string, columns: string, id: string, row: Record<string, unknown>, expectedUpdatedAt: string | undefined): Promise<T | null> {
    if (expectedUpdatedAt !== undefined) {
      const updated = await must<T[]>(this.db.from(table).update(row).eq("project_id", this.projectId).eq("id", id).eq("updated_at", expectedUpdatedAt).select(columns));
      if (updated.length) return updated[0];
    }
    const { data, error } = await this.db.from(table).insert({ project_id: this.projectId, ...row }).select(columns).single();
    if ((error as { code?: string } | null)?.code === "23505") return null;
    if (error) throw new Error(toUserMessage(error));
    return data as T;
  }
  private async drop(table: string, id: string, expectedUpdatedAt: string) {
    return (await must<unknown[]>(this.db.from(table).delete().eq("project_id", this.projectId).eq("id", id).eq("updated_at", expectedUpdatedAt).select("id"))).length > 0;
  }
  private async addMissing(table: string, rows: Array<Record<string, unknown>>) {
    if (!rows.length) return 0;
    const added = await must<unknown[]>(this.db.from(table).upsert(rows.map(row => ({ project_id: this.projectId, ...row })), { onConflict: "project_id,id", ignoreDuplicates: true }).select("id"));
    return added.length;
  }
}
