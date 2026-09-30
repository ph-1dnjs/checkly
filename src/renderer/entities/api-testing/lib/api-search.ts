/**
 * What an API search looks at for one operation: only what the screen shows (the API docs also show
 * the description, parameters and body once opened; short pickers only method, path, title and tag).
 */
export type SearchableOperation = {
  method: string;
  path: string;
  tag: string;
  summary?: string;
  /** Shown once the operation is opened. */
  description?: string;
  parameters: string[];
  /** Top-level request body field names. */
  bodyFields: string[];
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
export function pathFits(template: string, segments: string[]): boolean {
  const parts = template.replace(/\/+$/, "").split("/").slice(1);
  return parts.length === segments.length && parts.every((part, index) => /^\{[^}]+\}$/.test(part) || part === segments[index]);
}

const requestFits = (operation: SearchableOperation, request: NonNullable<ApiSearch["request"]>) =>
  (!request.method || request.method === operation.method.toUpperCase()) && pathFits(operation.path, request.segments);

export function matchesApiSearch(operation: SearchableOperation, search: ApiSearch): boolean {
  if (!search.terms.length) return true;
  if (search.request && requestFits(operation, search.request)) return true;
  const haystack = [operation.method, operation.path, operation.tag, operation.summary, operation.description, ...operation.parameters, ...operation.bodyFields]
    .filter((value): value is string => typeof value === "string").join("\n").toLocaleLowerCase();
  return search.terms.every(term => haystack.includes(term));
}

/**
 * Why a found operation matched, for what the list doesn't already show: the path variables a pasted
 * URL filled in, words only the (folded) description has, and parameter / body field names the words hit
 * (path variables are visible, so left out).
 */
export type ApiSearchReason = { variables: Array<[name: string, value: string]>; description?: true; parameters: string[]; bodyFields: string[] };

export function explainApiSearch(operation: SearchableOperation, search: ApiSearch): ApiSearchReason | null {
  if (!search.terms.length) return null;
  if (search.request && requestFits(operation, search.request)) {
    const segments = search.request.segments;
    const variables = operation.path.replace(/\/+$/, "").split("/").slice(1)
      .flatMap((part, index): Array<[string, string]> => /^\{[^}]+\}$/.test(part) ? [[part.slice(1, -1), segments[index] ?? ""]] : []);
    return { variables, parameters: [], bodyFields: [] };
  }
  const hit = (name: string) => search.terms.some(term => name.toLocaleLowerCase().includes(term));
  const parameters = operation.parameters.filter(name => hit(name) && !operation.path.includes(`{${name}}`));
  const bodyFields = operation.bodyFields.filter(hit);
  const listed = [operation.method, operation.path, operation.tag, operation.summary ?? ""].join("\n").toLocaleLowerCase();
  const folded = (operation.description ?? "").toLocaleLowerCase();
  const description = search.terms.some(term => !listed.includes(term) && folded.includes(term));
  return description || parameters.length || bodyFields.length ? { variables: [], ...(description ? { description: true as const } : {}), parameters, bodyFields } : null;
}

/** The words worth marking in the visible text (a pasted URL is matched structurally instead). */
export const highlightTerms = (search: ApiSearch) => search.request ? [] : search.terms;

/**
 * The same search for a short API list that shows method, path, title and tag only (AI API picker,
 * "API 바꾸기"): several words must all appear, or a pasted URL/path matches its template.
 */
export function searchesVisibleList(phrase: string, baseUrl = "") {
  const search = parseApiSearch(phrase, baseUrl);
  return (operation: { method: string; path: string; summary?: string }, tag: string) =>
    matchesApiSearch({ method: operation.method, path: operation.path, tag, summary: operation.summary, parameters: [], bodyFields: [] }, search);
}
