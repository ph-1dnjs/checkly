import type { AuthSession } from "../auth/types";
import type { LocalSessionStore } from "./storage";
import type { TeamSessionStore } from "./team-store";
import { sameTeam } from "./telemetry";
import type { LiveSession, LiveSessionSnapshot, RecordingScope, RecordingUploadResult } from "./types";

const validScope = (scope: RecordingScope) => {
  if (scope !== "local" && scope !== "team") throw new Error("올바르지 않은 기록 위치입니다.");
};
const visible = (session: LiveSession, auth: AuthSession | null) => !session.team || session.team.projectId === auth?.projectId;
const uploadable = (session: LiveSession, auth: AuthSession | null) => !!auth
  && (!session.team || sameTeam(session.team, auth)) && session.syncStatus !== "uploaded"
  && (session.status === "saved" || session.status === "interrupted");

// Capturing and reading local recordings never call the server. Only an explicit
// upload selection or the server tab reaches TeamSessionStore.
export class RecordingLibrary {
  private generation = 0;
  private uploading = new Set<string>();
  private deleting = new Set<string>();
  constructor(
    private readonly local: LocalSessionStore,
    private readonly team: Pick<TeamSessionStore, "list" | "read" | "save" | "remove">,
    private readonly session: () => AuthSession | null,
    private readonly active: () => LiveSession[] = () => [],
  ) {}

  identityChanged(): void { this.generation++; }
  private context() {
    const auth = this.session(), generation = this.generation;
    return { auth, assert: () => {
      const current = this.session();
      if (generation !== this.generation || (auth ? !sameTeam(auth, current) : !!current)) {
        throw new Error("계정이 변경되었습니다. 목록을 다시 열어 주세요.");
      }
    } };
  }

  async list(scope: RecordingScope = "local"): Promise<LiveSessionSnapshot> {
    validScope(scope);
    const context = this.context();
    const active = this.active().filter(item => visible(item, context.auth));
    let sessions: LiveSession[];
    if (scope === "team") {
      if (!context.auth) throw new Error("서버 기록을 보려면 로그인해 주세요.");
      sessions = await this.team.list();
    } else {
      const current = new Map(active.map(item => [item.id, item]));
      sessions = (await this.local.list(new Set(current.keys()))).filter(item => visible(item, context.auth))
        .map(item => current.get(item.id) ?? item);
    }
    context.assert();
    return { sessions, active: scope === "local" ? active : [], mode: context.auth ? "team" : "local",
      uploadableIds: scope === "local" ? sessions.filter(item => uploadable(item, context.auth) && !this.uploading.has(item.id)).map(item => item.id) : [] };
  }

  async read(id: string, scope: RecordingScope = "local") {
    validScope(scope);
    const context = this.context();
    if (scope === "team" && !context.auth) throw new Error("서버 기록을 보려면 로그인해 주세요.");
    const recording = await (scope === "team" ? this.team.read(id) : this.local.read(id));
    context.assert();
    if (!visible(recording.session, context.auth)) throw new Error("현재 프로젝트의 기록만 열 수 있습니다.");
    const active = scope === "local" && this.active().find(item => item.id === id);
    if (active) recording.session = { ...active };
    return recording;
  }

  async upload(ids: string[]): Promise<RecordingUploadResult> {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string")) {
      throw new Error("전송할 기록을 1~100개 선택해 주세요.");
    }
    const selected = [...new Set(ids)];
    const context = this.context();
    if (!context.auth) throw new Error("서버로 보내려면 로그인해 주세요.");
    if (this.uploading.size) throw new Error("기록을 전송 중입니다. 완료 후 다시 시도해 주세요.");
    this.uploading = new Set(selected);
    const result: RecordingUploadResult = { uploaded: [], failed: [] };
    try {
      for (const id of selected) {
        let localSession: LiveSession | undefined;
        try {
          context.assert();
          if (this.deleting.has(id)) throw new Error("삭제 중인 기록입니다.");
          if (this.active().some(item => item.id === id)) throw new Error("기록 수집이 끝난 후 전송해 주세요.");
          const recording = await this.local.read(id);
          context.assert();
          if (!visible(recording.session, context.auth)) throw new Error("현재 프로젝트의 기록만 전송할 수 있습니다.");
          if (!uploadable(recording.session, context.auth)) throw new Error("이미 전송했거나 전송할 수 없는 기록입니다.");
          localSession = recording.session;
          localSession.team = { projectId: context.auth.projectId, userId: context.auth.userId };
          localSession.syncStatus = "pending";
          delete localSession.syncError;
          await this.local.save(localSession);
          context.assert();
          await this.team.save(recording, localSession.browserSessionId ?? id);
          context.assert();
          localSession.syncStatus = "uploaded";
          await this.local.save(localSession);
          result.uploaded.push(id);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (localSession) {
            localSession.syncStatus = "error";
            localSession.syncError = "서버 전송 실패 · 로컬 기록은 보관됩니다. 다시 선택해 전송해 주세요.";
            await this.local.save(localSession);
          }
          result.failed.push({ id, message });
        }
      }
    } finally { this.uploading.clear(); }
    return result;
  }

  async remove(id: string, scope: RecordingScope = "local"): Promise<void> {
    validScope(scope);
    if (this.uploading.has(id)) throw new Error("전송 중인 기록은 완료 후 삭제해 주세요.");
    if (this.deleting.has(id)) throw new Error("이미 삭제 중인 기록입니다.");
    if (this.active().some(item => item.id === id)) throw new Error("오류 후 상황을 수집 중입니다. 잠시 후 삭제해 주세요.");
    const context = this.context();
    this.deleting.add(id);
    try {
      if (scope === "team") {
        if (!context.auth) throw new Error("서버 기록을 삭제하려면 로그인해 주세요.");
        await this.team.remove(id);
        context.assert();
        const local = (await this.local.list()).find(item => item.id === id && visible(item, context.auth));
        context.assert();
        if (local) { local.syncStatus = "local"; delete local.syncError; await this.local.save(local); }
      } else {
        const recording = await this.local.read(id);
        context.assert();
        if (!visible(recording.session, context.auth)) throw new Error("현재 프로젝트의 기록만 삭제할 수 있습니다.");
        await this.local.remove(id);
      }
    } finally { this.deleting.delete(id); }
  }
}
