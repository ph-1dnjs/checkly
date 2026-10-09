import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createClient,
  FunctionsHttpError,
  isAuthRetryableFetchError,
  type SupabaseClient,
  type SupportedStorage,
} from "@supabase/supabase-js";
import { AuthFailure, MESSAGES } from "./errors";
import { fromRows, normalizeSettings, toSavePayload, type EndpointRow, type EndpointUrlRow, type EnvironmentRow } from "./settings";
import type { AuthBridge, AuthRole, AuthSession, InvitePreview, ProjectInfo, ProjectSettings, RecentProject } from "./types";

// 팀 프로젝트 로그인(Supabase). Electron 없이 동작하도록 저장소·경로를 받아서 쓴다(Electron 연결은 instance.ts).
// 설계: docs/02-architecture/supabase-common.md

export type AuthEnv = { url: string; anonKey: string; emailDomain: string };

/** URL이나 anon 키가 없으면 null — 로그인 없이 기존 로컬 모드로 동작한다. */
export const readAuthEnv = (env: NodeJS.ProcessEnv = process.env): AuthEnv | null => {
  const url = env.CHECKLY_SUPABASE_URL?.trim();
  const anonKey = env.CHECKLY_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey, emailDomain: env.CHECKLY_AUTH_EMAIL_DOMAIN?.trim() || "checkly.test" };
};

/** 로그인용 가상 이메일. 실제로 메일을 보내지 않는다. */
export const authEmail = (nickname: string, projectCode: string, domain: string): string =>
  `${nickname}.${projectCode}@${domain}`;

const normalize = (value: string): string => String(value ?? "").trim().toLowerCase();

const MIN_PASSWORD = 6;
const RECENT_LIMIT = 10;
const STORAGE_KEY = "checkly-auth";

const must = async <T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
};
const writeJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), "utf8");
};

/** Edge Function 오류 본문 `{ error: { message } }`의 한국어 문장을 그대로 보여준다. */
const functionError = async (error: unknown): Promise<unknown> => {
  if (!(error instanceof FunctionsHttpError)) return error;
  const body = (await (error.context as Response).json().catch(() => null)) as { error?: { message?: unknown } } | null;
  return typeof body?.error?.message === "string" ? new AuthFailure(body.error.message) : error;
};

type MemberRow = { user_id: string; project_id: string; nickname: string; role: AuthRole; projects: { code: string } };

export type AuthServiceOptions = {
  env: AuthEnv;
  /** auth-remember.json, auth-recent-projects.json을 둘 폴더(Electron에서는 userData). */
  dataDir: string;
  /** supabase-js 세션 저장소(storage.ts). */
  storage: SupportedStorage;
  onSessionChanged?: (session: AuthSession | null) => void;
};

type Remembered = { projectCode: string; nickname: string };

export class AuthService implements Omit<AuthBridge, "getConfig" | "onSessionChange"> {
  /** 현재 멤버로 로그인된 클라이언트 하나. 로그아웃 상태면 anon 키로 요청한다. */
  readonly client: SupabaseClient;
  private current: AuthSession | null = null;
  private restoring: Promise<void> | undefined;
  /** 마지막으로 읽어 준 프로젝트 설정. 저장할 때 "읽었던 행"과 "모르는 새 행"을 가르는 기준이다. */
  private known: ProjectSettings | null = null;
  /** 사용자가 직접 하지 않은 로그아웃의 이유(내보내짐). 로그인 화면이 보여 주고, 다시 로그인하면 지운다. */
  private notice = "";

  constructor(private readonly options: AuthServiceOptions) {
    this.client = createClient(options.env.url, options.env.anonKey, {
      auth: {
        storage: options.storage,
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    // 토큰 갱신 실패·만료로 supabase-js가 세션을 지우면 로그아웃으로 알린다.
    this.client.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") this.setSession(null);
    });
  }

  get session(): AuthSession | null {
    return this.current;
  }

  private get rememberFile(): string {
    return path.join(this.options.dataDir, "auth-remember.json");
  }
  private get recentFile(): string {
    return path.join(this.options.dataDir, "auth-recent-projects.json");
  }

  private setSession(session: AuthSession | null): void {
    if (session) this.notice = "";
    if (JSON.stringify(session) === JSON.stringify(this.current)) return;
    this.current = session;
    this.known = null;
    this.options.onSessionChanged?.(session);
  }

  /** 시작할 때 한 번 저장된 세션을 복원한다. 네트워크 오류로 실패하면 다음 호출에서 다시 시도한다. */
  async getSession(): Promise<AuthSession | null> {
    this.restoring ??= this.restore().catch(error => {
      this.restoring = undefined;
      throw error;
    });
    await this.restoring;
    return this.current;
  }

  private async restore(): Promise<void> {
    const { data, error } = await this.client.auth.getSession();
    // 네트워크 오류면 저장된 세션을 그대로 두고 실패를 알린다. 그 밖의 갱신 실패는 supabase-js가 세션을 지운다.
    if (error && isAuthRetryableFetchError(error)) throw error;
    if (!data.session) return this.setSession(null);
    // 다시 시도하지 않는다: 오프라인이면 빈 화면으로 기다리게 하지 않고 바로 "다시 시도"를 보여 준다.
    const session = await this.loadMember(data.session.user.id, false);
    // 내보내진 멤버 등 프로젝트에 없는 계정이면 로그아웃한다.
    if (!session) return this.signOutRemoved();
    this.setSession(session);
  }

  /** 멤버 행이 보이지 않는 계정(내보내짐·프로젝트 삭제): 이 기기에서 로그아웃하고 로그인 화면에 이유를 남긴다. */
  private async signOutRemoved(): Promise<void> {
    this.notice = MESSAGES.removed;
    await this.client.auth.signOut({ scope: "local" });
    this.setSession(null);
  }

  /**
   * 요청이 권한·만료 오류로 실패했을 때 부른다(index.ts). 그 사이 관리자가 내보냈으면 토큰이 아직 살아 있어도
   * 멤버 행이 보이지 않으므로, 로그아웃해 로그인 화면으로 보낸다.
   */
  async checkMembership(): Promise<void> {
    const current = this.current;
    if (!current) return;
    const member = await this.loadMember(current.userId).catch(() => undefined);
    if (member === null && this.current === current) await this.signOutRemoved();
  }

  async getSignOutNotice(): Promise<string> {
    return this.notice;
  }

  /** 복원 중에 로그인·로그아웃이 겹치지 않게 기다린다. */
  private async settled(): Promise<void> {
    await this.restoring?.catch(() => undefined);
  }

  private async requireSession(): Promise<AuthSession> {
    await this.settled();
    if (!this.current) throw new AuthFailure(MESSAGES.signedOut);
    return this.current;
  }

  private async loadMember(userId: string, retry = true): Promise<AuthSession | null> {
    const row = (await must(
      this.client.from("members").select("user_id, project_id, nickname, role, projects(code)").eq("user_id", userId).maybeSingle().retry(retry),
    )) as MemberRow | null;
    if (!row) return null;
    return { userId: row.user_id, projectId: row.project_id, projectCode: row.projects.code, nickname: row.nickname, role: row.role };
  }

  private async signInAs(projectCode: string, nickname: string, password: string): Promise<AuthSession> {
    if (!projectCode || !nickname || !password) throw new AuthFailure(MESSAGES.badCredentials);
    const { data, error } = await this.client.auth.signInWithPassword({
      email: authEmail(nickname, projectCode, this.options.env.emailDomain),
      password,
    });
    if (error) throw error.status === 400 ? new AuthFailure(MESSAGES.badCredentials) : error;
    const session = await this.loadMember(data.user.id);
    if (!session) {
      await this.client.auth.signOut({ scope: "local" });
      throw new AuthFailure(MESSAGES.badCredentials);
    }
    await this.addRecent(session);
    this.setSession(session);
    return session;
  }

  async signIn(input: { projectCode: string; nickname: string; password: string; remember: boolean }): Promise<AuthSession> {
    await this.settled();
    const session = await this.signInAs(normalize(input.projectCode), normalize(input.nickname), input.password);
    if (input.remember) await writeJson(this.rememberFile, { projectCode: session.projectCode, nickname: session.nickname });
    else await rm(this.rememberFile, { force: true });
    return session;
  }

  async signOut(): Promise<void> {
    await this.settled();
    // 이 기기의 세션만 끝낸다. 서버에 못 닿아도 supabase-js가 로컬 세션은 지운다.
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) console.warn("[auth] 로그아웃 요청 실패", error);
    this.notice = "";
    this.setSession(null);
  }

  async getRemembered(): Promise<Remembered | null> {
    const value = await readJson<Remembered>(this.rememberFile);
    return typeof value?.projectCode === "string" && typeof value.nickname === "string"
      ? { projectCode: value.projectCode, nickname: value.nickname }
      : null;
  }

  async listRecentProjects(): Promise<RecentProject[]> {
    const list = await readJson<RecentProject[]>(this.recentFile);
    return Array.isArray(list) ? list.filter(p => typeof p?.projectCode === "string" && typeof p.nickname === "string") : [];
  }

  private async addRecent(session: AuthSession): Promise<void> {
    const rest = (await this.listRecentProjects()).filter(
      p => p.projectCode !== session.projectCode || p.nickname !== session.nickname,
    );
    const entry = { projectCode: session.projectCode, nickname: session.nickname, lastUsedAt: new Date().toISOString() };
    await writeJson(this.recentFile, [entry, ...rest].slice(0, RECENT_LIMIT));
  }

  // ─── 가입 전(anon) 확인 ───────────────────────────────

  async previewInvite(inviteCode: string): Promise<InvitePreview | null> {
    if (!inviteCode.trim()) return null;
    type Row = { project_code: string; owner_nickname: string; member_count: number; created_at: string };
    const rows = (await must(this.client.rpc("preview_invite", { p_invite: inviteCode.trim() }))) as Row[] | null;
    const row = rows?.[0];
    return row
      ? { projectCode: row.project_code, ownerNickname: row.owner_nickname, memberCount: row.member_count, createdAt: row.created_at }
      : null;
  }

  async isProjectCodeAvailable(code: string): Promise<boolean> {
    return Boolean(await must(this.client.rpc("project_code_available", { p_code: normalize(code) })));
  }

  async isNicknameAvailable(inviteCode: string, nickname: string): Promise<boolean> {
    return Boolean(
      await must(this.client.rpc("nickname_available", { p_invite: inviteCode.trim(), p_nickname: normalize(nickname) })),
    );
  }

  // ─── 가입(Edge Function) ──────────────────────────────

  private async invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.functions.invoke(name, { body });
    if (error) throw await functionError(error);
    return data as T;
  }

  async createProject(input: { code: string; nickname: string; password: string }): Promise<{ session: AuthSession; inviteCode: string }> {
    await this.settled();
    if (input.password.length < MIN_PASSWORD) throw new AuthFailure(MESSAGES.shortPassword);
    const code = normalize(input.code);
    const nickname = normalize(input.nickname);
    const result = await this.invoke<{ projectId: string; inviteCode: string }>("create-project", { code, nickname, password: input.password });
    const session = await this.signInAs(code, nickname, input.password);
    return { session, inviteCode: result.inviteCode };
  }

  async joinProject(input: { inviteCode: string; nickname: string; password: string }): Promise<AuthSession> {
    await this.settled();
    if (input.password.length < MIN_PASSWORD) throw new AuthFailure(MESSAGES.shortPassword);
    const nickname = normalize(input.nickname);
    const result = await this.invoke<{ projectId: string; projectCode: string }>("join-project", {
      inviteCode: input.inviteCode.trim(),
      nickname,
      password: input.password,
    });
    return this.signInAs(result.projectCode, nickname, input.password);
  }

  // ─── 프로젝트·계정 ────────────────────────────────────

  async getProject(): Promise<ProjectInfo> {
    const { projectId } = await this.requireSession();
    type ProjectRow = { id: string; code: string; invite_code: string; created_at: string };
    type Row = { user_id: string; nickname: string; role: AuthRole; created_at: string };
    const [project, members] = (await Promise.all([
      must(this.client.from("projects").select("id, code, invite_code, created_at").eq("id", projectId).single()),
      must(this.client.from("members").select("user_id, nickname, role, created_at").eq("project_id", projectId).order("created_at")),
    ])) as [ProjectRow, Row[]];
    return {
      id: project.id,
      code: project.code,
      inviteCode: project.invite_code,
      createdAt: project.created_at,
      members: members
        .map(m => ({ userId: m.user_id, nickname: m.nickname, role: m.role, createdAt: m.created_at }))
        .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner")),
    };
  }

  async regenerateInviteCode(): Promise<string> {
    await this.requireSession();
    return (await must(this.client.rpc("regenerate_invite_code"))) as string;
  }

  async removeMember(userId: string): Promise<void> {
    await this.requireSession();
    await this.invoke("remove-member", { userId });
  }

  async changeNickname(nickname: string): Promise<AuthSession> {
    const before = await this.requireSession();
    const result = await this.invoke<{ nickname: string }>("change-nickname", { nickname: normalize(nickname) });
    // 이메일이 바뀌었으므로 새 토큰을 받는다. 실패해도 사용자 id는 같아 다음 갱신 때 맞춰진다.
    const { error } = await this.client.auth.refreshSession();
    if (error) console.warn("[auth] 닉네임 변경 후 세션 갱신 실패", error);
    const after = { ...before, nickname: result.nickname };
    const same = (p: { projectCode: string; nickname: string }) => p.projectCode === before.projectCode && p.nickname === before.nickname;
    const remembered = await this.getRemembered();
    if (remembered && same(remembered)) await writeJson(this.rememberFile, { projectCode: after.projectCode, nickname: after.nickname });
    const recent = await this.listRecentProjects();
    if (recent.some(same)) await writeJson(this.recentFile, recent.map(p => (same(p) ? { ...p, nickname: after.nickname } : p)));
    this.setSession(after);
    return after;
  }

  async changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
    const session = await this.requireSession();
    if (input.newPassword.length < MIN_PASSWORD) throw new AuthFailure(MESSAGES.shortPassword);
    // 현재 비밀번호 확인은 따로 만든 클라이언트로 해서 지금 세션을 건드리지 않는다.
    const verifier = createClient(this.options.env.url, this.options.env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error } = await verifier.auth.signInWithPassword({
      email: authEmail(session.nickname, session.projectCode, this.options.env.emailDomain),
      password: input.currentPassword,
    });
    if (error) throw error.status === 400 ? new AuthFailure(MESSAGES.wrongPassword) : error;
    await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
    const updated = await this.client.auth.updateUser({ password: input.newPassword });
    if (updated.error) throw updated.error;
  }

  // ─── 프로젝트 설정(엔드포인트 × 환경 주소) ──────────────

  async getProjectSettings(): Promise<ProjectSettings> {
    const { projectId } = await this.requireSession();
    const [endpoints, environments, urls] = (await Promise.all([
      must(this.client.from("endpoints").select("id, name, kind, position, updated_at").eq("project_id", projectId).order("position").order("name")),
      must(this.client.from("environments").select("id, name, position, updated_at").eq("project_id", projectId).order("position").order("name")),
      must(this.client.from("endpoint_urls").select("endpoint_id, environment_id, base_url, spec_url, updated_at").eq("project_id", projectId)),
    ])) as [EndpointRow[], EnvironmentRow[], EndpointUrlRow[]];
    const settings = fromRows(endpoints, environments, urls);
    if (this.current?.projectId === projectId) this.known = settings;
    return settings;
  }

  async saveProjectSettings(settings: ProjectSettings): Promise<ProjectSettings> {
    await this.requireSession();
    const clean = normalizeSettings(settings);
    await must(this.client.rpc("save_project_settings", { p: toSavePayload(clean, this.known) }));
    return this.getProjectSettings();
  }
}
