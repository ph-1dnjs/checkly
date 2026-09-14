import { parseDocument } from "yaml";
import type { ApiCatalog, ApiOperation } from "../shared/workspace";
import type { Json } from "../shared/scenario";

type Obj = Record<string, any>;
const object = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const label = (v: unknown): string => typeof v === "string" ? v : "";
const methods = ["get", "post", "put", "patch", "delete", "head", "options"];

export function readOpenApi(source: string): ApiCatalog {
  if (Buffer.byteLength(source) > 5_000_000) throw new Error("명세는 5MB 이하만 지원합니다");
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error("OpenAPI JSON/YAML 문법을 확인하세요");
  const root = object(doc.toJS({ maxAliasCount: 30 }));
  if (!/^3\.(0|1)\./.test(label(root.openapi)) || !root.info || !root.paths)
    throw new Error("OpenAPI 3.0 또는 3.1 문서가 필요합니다");
  const deref = (v: unknown, seen: string[] = []): Obj => {
    const obj = object(v);
    if (!obj.$ref) return obj;
    const ref = label(obj.$ref);
    if (!ref.startsWith("#/")) throw new Error("외부 $ref는 지원하지 않습니다. 하나의 문서로 묶어 가져오세요");
    if (seen.includes(ref)) throw new Error("순환 참조를 이 위치에서 해석할 수 없습니다");
    let target: any = root;
    for (const key of ref.slice(2).split("/").map(k => k.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      if (!target || !Object.hasOwn(target, key)) throw new Error("명세의 $ref 대상을 찾을 수 없습니다");
      target = target[key];
    }
    return deref(target, [...seen, ref]);
  };
  const sample = (schema: unknown, depth = 0): Json => {
    if (depth > 5) return null;
    const s = deref(schema);
    if (s.example !== undefined) return s.example;
    if (s.default !== undefined) return s.default;
    if (s.enum?.length) return s.enum[0];
    if (s.type === "object" || s.properties) return Object.fromEntries(Object.entries(object(s.properties)).filter(([, v]) => !object(v).readOnly).map(([k, v]) => [k, sample(v, depth + 1)]));
    if (s.type === "array") return [];
    if (s.type === "number" || s.type === "integer") return 0;
    if (s.type === "boolean") return false;
    return "";
  };
  const operations: ApiOperation[] = [];
  for (const [path, rawItem] of Object.entries(object(root.paths))) {
    if (!path.startsWith("/")) continue;
    const item = deref(rawItem);
    for (const method of methods) {
      if (!item[method]) continue;
      const op = deref(item[method]);
      const warnings: string[] = [];
      const params = new Map<string, Obj>();
      for (const raw of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const p = deref(raw);
        params.set(`${p.in}:${p.name}`, p);
      }
      const parameters = [...params.values()].map(p => {
        const schema = deref(p.schema);
        if (!["path", "query", "header", "cookie"].includes(p.in) || ["array", "object"].includes(schema.type) || p.content || p.style && !["simple", "form"].includes(p.style))
          warnings.push(`${p.name}: 이 파라미터 형식은 아직 실행을 지원하지 않습니다`);
        return { name: label(p.name), location: label(p.in), required: p.in === "path" || Boolean(p.required), description: label(p.description), type: label(schema.type) || "string", example: p.example ?? schema.example ?? schema.default };
      });
      const requestBody = deref(op.requestBody);
      const content = object(requestBody.content);
      if (Object.keys(content).length && !content["application/json"]) warnings.push("현재 요청 본문은 application/json만 지원합니다");
      const json = object(content["application/json"]);
      const bodySchema = json.schema ? deref(json.schema) : undefined;
      operations.push({
        key: `${method.toUpperCase()} ${path}`, method: method.toUpperCase(), path, operationId: label(op.operationId) || undefined,
        summary: label(op.summary) || label(op.operationId) || path, description: label(op.description),
        tag: label(op.tags?.[0]) || "기타", parameters,
        tags: Array.isArray(op.tags) ? [...new Set(op.tags.filter((v: unknown): v is string => typeof v === "string" && Boolean(v.trim())))] as string[] : [],
        bodyRequired: Boolean(requestBody.required),
        bodyExample: json.example ?? (bodySchema ? sample(bodySchema) : undefined),
        bodySchema: bodySchema as Json | undefined,
        responses: Object.fromEntries(Object.entries(object(op.responses)).map(([k, v]) => [k, deref(v)])) as Json,
        warnings,
      });
    }
  }
  if (!operations.length) throw new Error("호출 가능한 API가 없는 명세입니다");
  return { title: label(root.info.title), version: label(root.info.version), importedAt: new Date().toISOString(), spec: root as Json, operations,
    tags: Array.isArray(root.tags) ? root.tags.map((tag: Obj) => ({ name: label(tag.name), description: label(tag.description) })).filter((tag: { name: string }) => tag.name) : [],
  };
}
