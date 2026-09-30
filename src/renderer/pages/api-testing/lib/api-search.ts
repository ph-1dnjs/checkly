/** What the API docs search looks at for one operation. */
export type SearchableOperation = {
  method: string;
  path: string;
  tag: string;
  /** operationId, summary, description, … */
  texts: Array<string | undefined>;
  /** Parameter names and top-level request body field names. */
  fields: string[];
};

export type ApiSearch = { terms: string[]; request?: { method?: string; segments: string[] } };

const methods = /^(get|post|put|patch|delete|head|options)\s+/i;

/**
 * Reads a search phrase: space-separated words that must all appear, and — for something like a
 * copied request (`GET https://host/base/items/7?x=1` or `/items/7`) — the concrete path to match
 * against path templates such as `/items/{id}`.
 */
export function parseApiSearch(phrase: string, baseUrl: string): ApiSearch {
  const trimmed = phrase.trim();
  const terms = trimmed.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const method = methods.exec(trimmed)?.[1];
  const target = method ? trimmed.slice(method.length).trim() : trimmed;
  if (/\s/.test(target) || !/^(https?:\/\/|\/)/i.test(target)) return { terms };
  let pathname = target;
  try { pathname = new URL(target, "http://placeholder").pathname; } catch { return { terms }; }
  // Drop the environment's base path (e.g. a gateway prefix) so the rest lines up with the spec.
  try {
    const base = new URL(baseUrl).pathname.replace(/\/$/, "");
    if (base && (pathname === base || pathname.startsWith(`${base}/`))) pathname = pathname.slice(base.length) || "/";
  } catch { /* No usable base URL: match the path as given. */ }
  const segments = pathname.replace(/\/+$/, "").split("/").slice(1).map(segment => { try { return decodeURIComponent(segment); } catch { return segment; } });
  return { terms, request: { ...(method ? { method: method.toUpperCase() } : {}), segments } };
}

/** A concrete path fits a template when every segment is equal or a `{variable}`. */
function pathFits(template: string, segments: string[]): boolean {
  const parts = template.replace(/\/+$/, "").split("/").slice(1);
  return parts.length === segments.length && parts.every((part, index) => /^\{[^}]+\}$/.test(part) || part === segments[index]);
}

export function matchesApiSearch(operation: SearchableOperation, search: ApiSearch, baseUrl: string): boolean {
  if (!search.terms.length) return true;
  if (search.request && (!search.request.method || search.request.method === operation.method.toUpperCase()) && pathFits(operation.path, search.request.segments)) return true;
  const haystack = [operation.method, operation.path, `${baseUrl.replace(/\/$/, "")}${operation.path}`, operation.tag, ...operation.texts, ...operation.fields]
    .filter((value): value is string => typeof value === "string").join("\n").toLocaleLowerCase();
  return search.terms.every(term => haystack.includes(term));
}
