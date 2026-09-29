import { type Json } from "../../../app/api-testing/shared/scenario";
import { objectValue } from "./response-fields";

export type ResponseDocument = { status: string; description: string; mediaType?: string; preview?: Json; previewLabel?: "Example Value" | "Schema" };
export function resolveSchema(value: unknown, spec: Json | undefined, seen = new Set<string>()): Record<string, any> {
  let node = objectValue(value);
  while (typeof node.$ref === "string" && node.$ref.startsWith("#/") && !seen.has(node.$ref)) {
    const ref = node.$ref;
    seen.add(ref);
    let resolved: unknown = spec;
    for (const key of ref.slice(2).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))) resolved = Object.hasOwn(objectValue(resolved), key) ? objectValue(resolved)[key] : undefined;
    if (resolved === undefined) break;
    node = objectValue(resolved);
  }
  return node;
}

export function sampleSchema(value: unknown, spec: Json | undefined, depth = 0): Json {
  if (depth > 12) return null;
  const node = resolveSchema(value, spec);
  if (node.example !== undefined) return node.example as Json;
  if (node.default !== undefined) return node.default as Json;
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0] as Json;
  if (node.type === "object" || node.properties) return Object.fromEntries(Object.entries(objectValue(node.properties)).map(([key, child]) => [key, sampleSchema(child, spec, depth + 1)]));
  if (node.type === "array") return [];
  if (node.type === "number" || node.type === "integer") return 0;
  if (node.type === "boolean") return false;
  return "string";
}

export function responseExample(media: Record<string, any>, spec?: Json): { value?: Json; label?: "Example Value" | "Schema" } {
  if (media.example !== undefined) return { value: media.example, label: "Example Value" };
  const firstExample = Object.values(objectValue(media.examples))[0];
  if (firstExample !== undefined) {
    const example = objectValue(firstExample);
    return { value: example.value !== undefined ? example.value : firstExample, label: "Example Value" };
  }
  if (media.schema !== undefined) return { value: sampleSchema(media.schema, spec), label: "Schema" };
  return {};
}

export function responseDocuments(responses: Json, spec?: Json): ResponseDocument[] {
  return Object.entries(objectValue(responses)).map(([status, raw]) => {
    const response = objectValue(raw);
    const media = Object.entries(objectValue(response.content)).find(([type]) => type === "application/json") ?? Object.entries(objectValue(response.content))[0];
    const mediaValue = media ? objectValue(media[1]) : {};
    const preview = responseExample(mediaValue, spec);
    return {
      status,
      description: typeof response.description === "string" ? response.description : "응답 명세",
      ...(media ? { mediaType: media[0] } : {}),
      ...(preview.value !== undefined ? { preview: preview.value, previewLabel: preview.label } : {}),
    };
  });
}

export type ResponseField = { pointer: string; type: string; status: string };
export type ResponseBadge = { label: string; tone: "global" | "link" | "verify" | "save"; title?: string };

export function responseFieldName(pointer: string): string {
  const last = pointer.split("/").filter(Boolean).pop();
  if (!last) return "전체 응답";
  return last.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function responseFieldKey(pointer: string): string {
  const name = responseFieldName(pointer);
  return JSON.stringify(name);
}

export function jsonPointerValue(value: Json | undefined, pointer: string): Json | undefined {
  if (!pointer) return value;
  let current: unknown = value;
  for (const part of pointer.slice(1).split("/").map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (current && typeof current === "object") current = Object.hasOwn(current, part) ? (current as Record<string, unknown>)[part] : undefined;
    else return undefined;
  }
  return current as Json | undefined;
}

export function jsonValueType(value: Json): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function responseFieldsFromValue(value: Json, status: string): ResponseField[] {
  const result: ResponseField[] = [];
  const visit = (current: Json, pointer: string, depth: number) => {
    if (depth > 12 || result.length >= 500) return;
    result.push({ pointer, type: jsonValueType(current), status });
    if (Array.isArray(current)) current.forEach((child, index) => visit(child, `${pointer}/${index}`, depth + 1));
    else if (current !== null && typeof current === "object") Object.entries(current).forEach(([key, child]) => visit(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1));
  };
  visit(value, "", 0);
  return result;
}

export function responseFieldsWithoutArrayItems(fields: ResponseField[]): ResponseField[] {
  const arrays = fields.filter(field => field.type === "array").map(field => field.pointer);
  return fields.filter(field => !arrays.some(arrayPointer => {
    const prefix = arrayPointer ? `${arrayPointer}/` : "/";
    if (!field.pointer.startsWith(prefix)) return false;
    return /^\d+(?:\/|$)/.test(field.pointer.slice(prefix.length));
  }));
}

export function responseToken(value: Json | undefined, type: string): string {
  if (value !== undefined) {
    if (value !== null && typeof value === "object") return Array.isArray(value) ? "[" : "{";
    return JSON.stringify(value) ?? "null";
  }
  if (type === "object") return "{";
  if (type === "array") return "[";
  if (type === "string") return '"string"';
  if (type === "boolean") return "false";
  if (type === "number" || type === "integer") return "0";
  return "null";
}
