import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthSession } from "../auth/types";
import type { LiveSession, SessionRecording } from "./types";
import { MAX_SESSION_BYTES } from "./storage";
import { sameTeam } from "./telemetry";

const compress = promisify(gzip), decompress = promisify(gunzip);
export const REPLAY_BUCKET = "browser-error-replays";
const validId = (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error("올바르지 않은 세션 ID입니다.");
};

export class TeamSessionStore {
  constructor(private readonly client: () => SupabaseClient, private readonly session: () => AuthSession | null) {}

  private assertSession(expected = this.session()): AuthSession {
    const current = this.session();
    if (!expected || !sameTeam(expected, current)) throw new Error("프로젝트가 변경되었습니다. 목록을 다시 열어 주세요.");
    return current!;
  }

  async save(recording: SessionRecording, browserSessionId: string): Promise<void> {
    const auth = this.assertSession();
    if (!sameTeam(recording.session.team, auth)) throw new Error("현재 로그인한 프로젝트의 기록만 업로드할 수 있습니다.");
    const { syncStatus: _sync, syncError: _error, ...session } = recording.session;
    validId(session.id);
    const text = JSON.stringify({ session, documents: recording.documents });
    if (Buffer.byteLength(text) > MAX_SESSION_BYTES) throw new Error("기록 업로드 한도(50MB)를 초과했습니다.");
    const body = await compress(Buffer.from(text));
    this.assertSession(auth);
    const objectPath = `${auth.projectId}/${auth.userId}/${session.id}.json.gz`;
    const { error: uploadError } = await this.client().storage.from(REPLAY_BUCKET).upload(objectPath, body, { contentType: "application/gzip", upsert: true });
    if (uploadError) throw uploadError;
    this.assertSession(auth);
    const { error } = await this.client().from("form_browser_recordings").upsert({
      id: session.id, project_id: auth.projectId, created_by: auth.userId,
      browser_session_id: browserSessionId, trigger_log_id: session.trigger?.logId ?? null,
      started_at: new Date(session.startedAt).toISOString(), object_path: objectPath, metadata: session,
    }, { onConflict: "id" }).abortSignal(AbortSignal.timeout(10_000));
    if (error) throw error;
    this.assertSession(auth);
  }

  async list(): Promise<LiveSession[]> {
    const auth = this.assertSession();
    const { data, error } = await this.client().from("form_browser_recordings").select("metadata")
      .eq("project_id", auth.projectId).order("started_at", { ascending: false }).limit(200).abortSignal(AbortSignal.timeout(10_000));
    if (error) throw error;
    this.assertSession(auth);
    return (data ?? []).map(row => ({ ...row.metadata as LiveSession, syncStatus: "uploaded" }));
  }

  private async find(id: string) {
    validId(id);
    const auth = this.assertSession();
    const { data, error } = await this.client().from("form_browser_recordings").select("object_path,metadata")
      .eq("project_id", auth.projectId).eq("id", id).abortSignal(AbortSignal.timeout(10_000)).single();
    if (error) throw error;
    this.assertSession(auth);
    return { auth, row: data };
  }

  async read(id: string): Promise<SessionRecording> {
    const { auth, row } = await this.find(id);
    const { data, error } = await this.client().storage.from(REPLAY_BUCKET).download(row.object_path, {}, { signal: AbortSignal.timeout(10_000) });
    if (error) throw error;
    this.assertSession(auth);
    if (data.size > MAX_SESSION_BYTES) throw new Error("기록 파일이 너무 큽니다.");
    const text = await decompress(Buffer.from(await data.arrayBuffer()), { maxOutputLength: MAX_SESSION_BYTES });
    const recording = JSON.parse(text.toString()) as SessionRecording;
    this.assertSession(auth);
    if (recording.session?.id !== id || recording.session.team?.projectId !== auth.projectId || !Array.isArray(recording.documents)) {
      throw new Error("잘못된 브라우저 기록입니다.");
    }
    return { ...recording, session: { ...recording.session, syncStatus: "uploaded" } };
  }

  async remove(id: string): Promise<void> {
    const { auth, row } = await this.find(id);
    await this.removeObjectAndRow(auth, id, row.object_path);
  }

  // A timed-out DB write may have committed. Delete deterministic pending paths too.
  async removeLocal(session: LiveSession): Promise<void> {
    validId(session.id);
    const auth = this.assertSession();
    if (session.team?.projectId !== auth.projectId) throw new Error("현재 프로젝트의 기록만 삭제할 수 있습니다.");
    await this.removeObjectAndRow(auth, session.id, `${auth.projectId}/${session.team.userId}/${session.id}.json.gz`);
  }

  private async removeObjectAndRow(auth: AuthSession, id: string, objectPath: string): Promise<void> {
    // Remove the object first, retaining its DB pointer if Storage fails so deletion can be retried.
    const { error: storageError } = await this.client().storage.from(REPLAY_BUCKET).remove([objectPath]);
    if (storageError) throw storageError;
    this.assertSession(auth);
    const { error } = await this.client().from("form_browser_recordings").delete().eq("project_id", auth.projectId).eq("id", id)
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw error;
    this.assertSession(auth);
  }
}
