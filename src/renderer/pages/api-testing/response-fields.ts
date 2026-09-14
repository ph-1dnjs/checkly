import type { Json } from "../../../app/api-testing/shared/scenario";

export const objectValue = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
export function responseFields(responses: Json, spec?: Json) {
  const result: Array<{ pointer: string; type: string; status: string }> = [];
  for (const [status, response] of Object.entries(objectValue(responses))) {
    const data = objectValue(response);
    const media = objectValue(data.content);
    const schema = data.schema ?? Object.values(media).find(v => objectValue(v).schema)?.schema;
    const visit = (value: unknown, pointer: string, depth: number) => {
      if (depth > 12 || result.length >= 500) return;
      let node = objectValue(value);
      const seen = new Set<string>();
      while (node.$ref) {
        const ref = node.$ref;
        if (typeof ref !== "string" || !ref.startsWith("#/") || seen.has(ref)) return;
        seen.add(ref);
        let resolved: unknown = spec;
        for (const key of ref.slice(2).split("/").map((part: string) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) resolved = Object.hasOwn(objectValue(resolved), key) ? objectValue(resolved)[key] : undefined;
        if (!resolved) return;
        node = objectValue(resolved);
      }
      result.push({ pointer, type: node.type ?? (node.properties ? "object" : "unknown"), status });
      for (const [key, child] of Object.entries(objectValue(node.properties))) visit(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1);
      if (node.items) visit(node.items, `${pointer}/0`, depth + 1);
    };
    if (schema) visit(schema, "", 0);
  }
  return result;
}
