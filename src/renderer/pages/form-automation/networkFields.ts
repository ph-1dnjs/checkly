import type { NetworkEvent } from "./liveQa";
import type { NetworkSpec } from "./networkSpec";

export type FieldSchema = Record<string, unknown>;
export type NetworkField = {
  name: string;
  schema: FieldSchema;
  value: unknown;
  present: boolean;
  required: boolean;
  compare: boolean;
  location?: string;
  undocumented?: boolean;
  forbidden?: boolean;
};
export type FieldDirection = "request" | "response";
export const asObject = (value: unknown): FieldSchema => value && typeof value === "object" && !Array.isArray(value) ? value as FieldSchema : {};

/** The display receives expanded refs; retain allOf fields and their required flags. */
export function fieldSchema(value: unknown, depth = 0): FieldSchema {
  const schema = asObject(value);
  if (depth > 20 || !Array.isArray(schema.allOf)) return schema;
  return schema.allOf.reduce<FieldSchema>((merged, part) => {
    const child = fieldSchema(part, depth + 1);
    return { ...merged, ...child,
      properties: { ...asObject(merged.properties), ...asObject(child.properties) },
      required: [...new Set([...(Array.isArray(merged.required) ? merged.required : []), ...(Array.isArray(child.required) ? child.required : [])])],
    };
  }, { ...schema, allOf: undefined });
}

const typesOf = (schema: FieldSchema): string[] => Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === "string")
  : typeof schema.type === "string" ? [schema.type] : schema.properties ? ["object"] : schema.items ? ["array"] : [];

export function fieldType(schema: FieldSchema): string {
  const types = typesOf(schema);
  if (types.length) return types.join(" | ");
  if (schema.oneOf || schema.anyOf) return schema.oneOf ? "oneOf" : "anyOf";
  return typeof schema.$ref === "string" ? schema.$ref.split("/").at(-1) || "$ref" : "—";
}

export function fieldIssue(field: NetworkField): string | undefined {
  if (!field.compare) return undefined;
  if (!field.present) return field.required ? "필수 값 누락" : undefined;
  if (field.forbidden) return "허용되지 않은 필드";
  const types = typesOf(field.schema);
  let value = field.value;
  // URL parameters are serialized strings, not JSON values.
  if (["query", "path"].includes(field.location || "") && typeof value === "string") {
    if (types.some(type => type === "integer" || type === "number") && value.trim() && Number.isFinite(Number(value))) value = Number(value);
    else if (types.includes("boolean") && ["true", "false"].includes(value)) value = value === "true";
  }
  if (value === null && (field.schema.nullable || types.includes("null"))) return undefined;
  if (types.length && !types.some(type => type === "null" ? value === null : type === "array" ? Array.isArray(value)
    : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "integer" ? typeof value === "number" && Number.isInteger(value) : typeof value === type)) return `타입 불일치 · ${fieldType(field.schema)} 필요`;
  if (Array.isArray(field.schema.enum) && !field.schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return "허용값과 다름";
  return undefined;
}

export function childFields(field: NetworkField, direction: FieldDirection): NetworkField[] {
  const schema = fieldSchema(field.schema);
  const object = asObject(field.value);
  if (typesOf(schema).includes("object") || schema.properties) {
    const properties = asObject(schema.properties);
    const names = [...new Set([...Object.keys(properties), ...Object.keys(object)])];
    return names.filter(name => !(direction === "request" ? asObject(properties[name]).readOnly : asObject(properties[name]).writeOnly)).map(name => ({
      name, schema: fieldSchema(properties[name] ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : {})),
      value: object[name], present: Object.hasOwn(object, name), required: Array.isArray(schema.required) && schema.required.includes(name),
      compare: field.compare && field.present && field.value !== null && typeof field.value === "object" && !Array.isArray(field.value),
      undocumented: !Object.hasOwn(properties, name), forbidden: !Object.hasOwn(properties, name) && schema.additionalProperties === false,
    }));
  }
  if (typesOf(schema).includes("array") || Array.isArray(field.value)) {
    const values = Array.isArray(field.value) ? field.value : [];
    return values.length ? values.slice(0, 100).map((value, index) => ({ name: `[${index}]`, schema: fieldSchema(schema.items), value,
      present: true, required: false, compare: field.compare, location: field.location }))
      : schema.items ? [{ name: "[item]", schema: fieldSchema(schema.items), value: undefined, present: false, required: false, compare: false }] : [];
  }
  return [];
}

export function hasFieldIssue(field: NetworkField, direction: FieldDirection, depth = 0): boolean {
  return Boolean(fieldIssue(field)) || (depth < 8 && childFields(field, direction).some(child => hasFieldIssue(child, direction, depth + 1)));
}

export function bodyFields(schema: unknown, value: unknown, required: boolean, direction: FieldDirection): NetworkField[] {
  const root: NetworkField = { name: "본문", schema: fieldSchema(schema), value, present: value !== undefined, required, compare: true };
  return root.present && value !== null && typeof value === "object" && !Array.isArray(value) && !fieldIssue(root) && root.schema.properties ? childFields(root, direction) : [root];
}

export function parameterFields(spec: NetworkSpec, event: NetworkEvent): NetworkField[] {
  let url: URL | undefined;
  try { url = new URL(spec.matchedUrl, event.pageUrl); } catch { /* No collected URL. */ }
  const template = spec.path.split("/");
  const segments = url?.pathname.split("/") || [];
  return (Array.isArray(spec.parameters) ? spec.parameters : []).map(raw => {
    const parameter = asObject(raw);
    const name = String(parameter.name || "parameter");
    const location = String(parameter.in || "");
    let value: unknown;
    let present = false;
    if (location === "query" && url) {
      const values = url.searchParams.getAll(name);
      present = values.length > 0;
      value = values.length > 1 ? values : values[0];
    } else if (location === "path" && url) {
      const index = template.indexOf(`{${name}}`);
      present = index >= 0 && segments[index] !== undefined;
      value = present ? segments[index] : undefined;
      try { if (typeof value === "string") value = decodeURIComponent(value); } catch { /* Display the captured value. */ }
    }
    const schema = fieldSchema(parameter.schema);
    if (location === "query" && typesOf(schema).includes("array") && typeof value === "string") {
      value = parameter.style === "spaceDelimited" ? value.split(" ") : parameter.style === "pipeDelimited" ? value.split("|")
        : parameter.explode === false ? value.split(",") : [value];
    }
    return { name, schema: { ...schema, description: parameter.description || schema.description }, value, present,
      required: location === "path" || parameter.required === true, compare: Boolean(url) && ["path", "query"].includes(location), location };
  });
}

export function mediaSchema(definition: unknown, contentType?: string) {
  const content = asObject(asObject(definition).content);
  const preferred = contentType?.split(";")[0].trim();
  const mediaType = preferred && Object.hasOwn(content, preferred) ? preferred
    : Object.hasOwn(content, "application/json") ? "application/json" : Object.keys(content)[0];
  return { mediaType, schema: asObject(content[mediaType]).schema };
}

export function fieldValue(field: NetworkField): string {
  if (!field.compare && !field.present) return field.location ? "미수집" : "—";
  if (!field.present) return "없음";
  if (Array.isArray(field.value)) return `${field.value.length}개 항목`;
  if (field.value !== null && typeof field.value === "object") return `${Object.keys(field.value).length}개 필드`;
  return JSON.stringify(field.value) ?? "없음";
}
