import type { ApiOperation } from "../../../../../app/api-testing/shared/workspace";

export type ResponseGlobalNameSuggestion = {
  id: "field" | "path";
  label: string;
  name: string;
  detail: string;
};

function identifier(value: string, fallback: string): string {
  const normalized = value
    .replace(/[{}]/g, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!normalized) return fallback;
  return /^[A-Za-z]/.test(normalized) ? normalized : `${fallback}_${normalized}`;
}

function pointerSegments(pointer: string | null): string[] {
  if (!pointer) return [];
  return pointer
    .split("/")
    .slice(1)
    .map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .filter(segment => segment && !/^\d+$/.test(segment));
}

/** Builds editable response-global names from the selected JSON field and endpoint path. */
export function responseGlobalNameSuggestions(operation: Pick<ApiOperation, "path"> | undefined, pointer: string | null): ResponseGlobalNameSuggestion[] {
  const segments = pointerSegments(pointer);
  const field = identifier(segments.at(-1) ?? "response", "response");
  const pathSegments = (operation?.path ?? "").split("/").filter(segment => segment && !/^\{[^}]+\}$/.test(segment));
  const path = identifier(pathSegments.join("_"), "response");
  const suggestions = [
    { id: "field" as const, label: "필드명", name: field, detail: `선택한 필드 · ${field}` },
    ...(pathSegments.length > 0 ? [{ id: "path" as const, label: "경로 + 필드명", name: `${path}_${field}`, detail: `${operation?.path ?? "엔드포인트"} · ${field}` }] : []),
  ];
  return suggestions.filter((suggestion, index) => suggestions.findIndex(other => other.name === suggestion.name) === index);
}
