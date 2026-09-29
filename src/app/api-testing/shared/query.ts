import type { Json } from "./scenario";

export type QueryParameterShape = {
  name: string;
  type?: string;
  style?: string;
  explode?: boolean;
};

export function supportsQueryParameter(parameter: QueryParameterShape): boolean {
  const style = parameter.style ?? "form";
  if (parameter.type === "array") return ["form", "spaceDelimited", "pipeDelimited"].includes(style);
  if (parameter.type === "object") return ["form", "deepObject"].includes(style) && !(style === "deepObject" && parameter.explode === false);
  return ["form", "simple"].includes(style);
}

function queryScalar(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value) ?? "null";
  return String(value);
}

/**
 * Append one OpenAPI query parameter while retaining its declared shape.
 * OpenAPI's defaults are form + explode=true for query parameters.
 */
export function appendQueryParameter(url: URL, name: string, value: Json, parameter?: QueryParameterShape): void {
  const type = parameter?.type ?? (Array.isArray(value) ? "array" : value !== null && typeof value === "object" ? "object" : "string");
  const style = parameter?.style ?? "form";
  const explode = parameter?.explode ?? style === "form";

  if (type === "array" && Array.isArray(value)) {
    const items = value.map(queryScalar);
    if (style === "spaceDelimited") url.searchParams.set(name, items.join(" "));
    else if (style === "pipeDelimited") url.searchParams.set(name, items.join("|"));
    else if (explode) items.forEach(item => url.searchParams.append(name, item));
    else url.searchParams.set(name, items.join(","));
    return;
  }

  if (type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (style === "deepObject") entries.forEach(([key, item]) => url.searchParams.append(`${name}[${key}]`, queryScalar(item)));
    else if (explode) entries.forEach(([key, item]) => url.searchParams.append(key, queryScalar(item)));
    else url.searchParams.set(name, entries.flatMap(([key, item]) => [key, queryScalar(item)]).join(","));
    return;
  }

  url.searchParams.set(name, queryScalar(value));
}
