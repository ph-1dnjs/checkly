import { randomUUID } from "node:crypto";
import { safePageUrl } from "./storage";
import { recordedBody } from "./payload";

import type { BrowserLog } from "./types";
export type { BrowserLog } from "./types";
const pageErrors = ["page-error", "resource-error", "unhandled-rejection", "console-error"];

// Metadata is allowlisted; failed API payloads pass through bounded redaction.
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
  const isError = pageErrors.includes(kind) || status === 0 || (status !== null && status >= 400) || !!event.error;
  return {
    id: randomUUID(), browser_session_id: sessionId, source, kind, occurred_at: new Date(now).toISOString(), url,
    page_url: safePageUrl(typeof event.pageUrl === "string" ? event.pageUrl : ""),
    method: typeof event.method === "string" && /^[A-Z]{1,16}$/.test(event.method) ? event.method : null,
    status, duration_ms: typeof event.elapsed === "number" && Number.isFinite(event.elapsed) ? Math.max(0, Math.min(86_400_000, Math.round(event.elapsed))) : null,
    is_error: isError,
    ...(["fetch", "xhr"].includes(kind) && isError ? { payload: {
      request: recordedBody(event.requestBody),
      response: status === 0 ? { state: "unavailable" as const, note: "연결 실패로 응답을 받지 못했습니다." } : recordedBody(event.responseBody),
      responseContentType: typeof event.responseContentType === "string" ? event.responseContentType.slice(0, 120).replace(/[^\w\s/;=.+-]/g, "") : undefined,
    } } : {}),
  };
};

export const sameTeam = (a: { projectId: string; userId: string } | null | undefined, b: { projectId: string; userId: string } | null | undefined): boolean =>
  !!a && !!b && a.projectId === b.projectId && a.userId === b.userId;
