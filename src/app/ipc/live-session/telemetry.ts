import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthSession } from "../auth/types";
import { safePageUrl } from "./storage";

export type BrowserLog = {
  id: string;
  browser_session_id: string;
  source: "browser" | "scenario";
  kind: string;
  occurred_at: string;
  url: string;
  page_url: string;
  method: string | null;
  status: number | null;
  duration_ms: number | null;
  is_error: boolean;
};
const pageErrors = ["page-error", "resource-error", "unhandled-rejection", "console-error"];

// Allowlist only metadata. Never copy page-supplied bodies, headers, error messages or stacks.
export const browserLog = (payload: unknown, sessionId: string, source: BrowserLog["source"], now = Date.now()): BrowserLog | null => {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as Record<string, unknown>;
  const kind = typeof event.type === "string" ? event.type : "";
  if (!["fetch", "xhr", "navigation", ...pageErrors].includes(kind)) return null;
  let url = "";
  try { url = safePageUrl(new URL(String(event.url ?? ""), typeof event.pageUrl === "string" ? event.pageUrl : undefined).href); }
  catch { return null; }
  if (!/^https?:\/\//.test(url)) return null;
  const status = typeof event.status === "number" && Number.isInteger(event.status) && event.status >= 0 && event.status <= 599 ? event.status : null;
  return {
    id: randomUUID(), browser_session_id: sessionId, source, kind, occurred_at: new Date(now).toISOString(), url,
    page_url: safePageUrl(typeof event.pageUrl === "string" ? event.pageUrl : ""),
    method: typeof event.method === "string" && /^[A-Z]{1,16}$/.test(event.method) ? event.method : null,
    status, duration_ms: typeof event.elapsed === "number" && Number.isFinite(event.elapsed) ? Math.max(0, Math.min(86_400_000, Math.round(event.elapsed))) : null,
    is_error: pageErrors.includes(kind) || status === 0 || (status !== null && status >= 400) || !!event.error,
  };
};

export const sameTeam = (a: { projectId: string; userId: string } | null | undefined, b: { projectId: string; userId: string } | null | undefined): boolean =>
  !!a && !!b && a.projectId === b.projectId && a.userId === b.userId;

export class BrowserTelemetry {
  private pending: (BrowserLog & { project_id: string; created_by: string })[] = [];
  private running?: Promise<void>;
  private generation = 0;
  private failure?: string;
  constructor(private readonly client: () => SupabaseClient, private readonly session: () => AuthSession | null) {}

  reset(): void { this.generation++; this.pending = []; this.failure = undefined; }
  get error(): string | undefined { return this.failure; }

  add(log: BrowserLog): void {
    const session = this.session();
    if (!session) return;
    if (this.pending.length >= 2000) {
      this.failure = "로그 전송 대기 한도(2,000개)에 도달했습니다. 새 로그 일부는 전송되지 않습니다.";
      return;
    }
    this.pending.push({ ...log, project_id: session.projectId, created_by: session.userId });
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.send().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async send(): Promise<void> {
    const generation = this.generation;
    while (this.pending.length && generation === this.generation) {
      const session = this.session();
      if (!session) { this.reset(); return; }
      const batch = this.pending.slice(0, 100);
      if (batch.some(row => row.project_id !== session.projectId || row.created_by !== session.userId)) { this.reset(); return; }
      try {
        // Stable UUIDs make retries safe even when the server committed before a timeout.
        const { error } = await this.client().from("form_browser_logs").upsert(batch, { onConflict: "id", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(10_000));
        if (error) throw error;
        if (generation !== this.generation) return;
        this.pending.splice(0, batch.length);
        this.failure = undefined;
      } catch {
        if (generation === this.generation) this.failure = "API·이동 로그를 전송하지 못했습니다. 연결 복구 후 다시 시도합니다.";
        return;
      }
    }
  }
}
