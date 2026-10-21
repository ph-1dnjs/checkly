type NetworkEventLike = {
  type?: unknown;
  method?: unknown;
  url?: unknown;
  pageUrl?: unknown;
  status?: unknown;
  error?: unknown;
  responseBody?: unknown;
  responseContentType?: unknown;
  nextInternal?: unknown;
};

/** Shared, process-independent rule; also injected into the guest preload. */
export function isNextInternalNetworkEvent(event: NetworkEventLike): boolean {
  if (event.type !== "fetch" && event.type !== "xhr") return false;
  // Keep server actions, API writes and framework failures useful for diagnosis.
  if (!["GET", "HEAD"].includes(String(event.method || "GET").toUpperCase())
    || event.error || Number(event.status) === 0 || Number(event.status) >= 400) return false;
  if (event.nextInternal === true || /^text\/x-component(?:\s*;|$)/i.test(String(event.responseContentType || ""))) return true;
  try {
    const url = new URL(String(event.url || ""), String(event.pageUrl || "https://checkly.local"));
    if (url.searchParams.has("_rsc") || /(?:^|\/)_next\//.test(url.pathname)) return true;
  } catch { /* Legacy records can still be recognized by their Flight payload. */ }
  if (typeof event.responseBody !== "string") return false;
  const body = event.responseBody.slice(0, 8192);
  return /^[0-9a-f]+:/m.test(body) && /\$Sreact\.(?:fragment|suspense)|\/_next\/static\//.test(body);
}
