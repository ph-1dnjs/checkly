import type { LiveSession } from "./types";
import { safePageUrl } from "./storage";

export const failureTrigger = (payload: unknown): LiveSession["trigger"] | null => {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type : "";
  const status = typeof event.status === "number" ? event.status : undefined;
  const pageError = ["page-error", "resource-error", "unhandled-rejection", "console-error"].includes(type);
  const networkError = ["fetch", "xhr", "navigation"].includes(type) && (status === 0 || (status !== undefined && status >= 400) || !!event.error);
  if (!pageError && !networkError) return null;
  return { type, at: Date.now(), url: safePageUrl(String(event.url || event.pageUrl || "")), ...(status !== undefined ? { status } : {}) };
};
