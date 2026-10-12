import type { Json, Scenario } from "./scenario";
import { isSensitiveKey } from "./sensitive";

/**
 * The last values typed into the API docs' "Try it out" for one API, so they are filled in
 * again next time. Values under secret-looking names (password, token, Authorization, …) are
 * not kept (body keys stay with an empty value); those are typed again or come from the request auth.
 * Exception: a team project with "비밀값도 팀에 공유" on keeps them too (`keepSecrets`).
 */
export type ApiDocInput = {
  pathParams?: Record<string, Json>;
  query?: Record<string, Json>;
  headers?: Record<string, string>;
  cookies?: Record<string, Json>;
  body?: Json;
};

const maxBodyLength = 100_000;

/** Body secrets keep their key with an empty value, so only the value has to be typed again. */
function withoutSecrets(value: Json): Json {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isSensitiveKey(key) ? "" : withoutSecrets(item)]));
  return value;
}

function keptValues<T extends Json>(values: Record<string, T> | undefined, keepSecrets: boolean): Record<string, T> | undefined {
  const kept = Object.entries(values ?? {}).filter(([name, value]) => (keepSecrets || !isSensitiveKey(name)) && value !== undefined && value !== "");
  return kept.length ? Object.fromEntries(kept.map(([name, value]) => [name, (keepSecrets ? value : withoutSecrets(value)) as T])) : undefined;
}

/** What to remember from a docs request; undefined when nothing is left to keep. */
export function docInputFromRequest(request: Scenario["steps"][number]["request"], { keepSecrets = false }: { keepSecrets?: boolean } = {}): ApiDocInput | undefined {
  const input: ApiDocInput = {};
  const pathParams = keptValues(request.pathParams, keepSecrets), query = keptValues(request.query, keepSecrets), headers = keptValues(request.headers, keepSecrets), cookies = keptValues(request.cookies, keepSecrets);
  if (pathParams) input.pathParams = pathParams;
  if (query) input.query = query;
  if (headers) input.headers = headers;
  if (cookies) input.cookies = cookies;
  if (request.body !== undefined) {
    const body = keepSecrets ? request.body : withoutSecrets(request.body);
    if (JSON.stringify(body).length <= maxBodyLength) input.body = body;
  }
  return Object.keys(input).length ? input : undefined;
}

/** A remembered input with its secrets taken out again (when sharing them is turned off). */
export function docInputWithoutSecrets(input: ApiDocInput): ApiDocInput | undefined {
  return docInputFromRequest({ ...input });
}
