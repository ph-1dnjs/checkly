import type { ApiCatalog, ApiOperation } from "../../../app/api-testing/shared/workspace";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const names = new Intl.Collator("ko", { sensitivity: "variant" });
const compareNames = (a: string, b: string) => names.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const rank = (method: string) => {
  const index = methods.indexOf(method);
  return index < 0 ? methods.length : index;
};

// Presentation only: never sort the catalog or scenario steps in place.
export function groupDocumentation(catalog: ApiCatalog, query = "") {
  const groups = new Map<string, ApiOperation[]>();
  for (const operation of catalog.operations) {
    const tags = [...new Set(operation.tags?.length ? operation.tags : [operation.tag || "기타"])];
    if (!`${operation.method} ${operation.path} ${operation.summary} ${tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())) continue;
    for (const tag of tags) {
      const group = groups.get(tag) ?? [];
      group.push(operation);
      groups.set(tag, group);
    }
  }
  const declared = [...new Set((catalog.tags ?? []).map(tag => tag.name))];
  const declaredSet = new Set(declared);
  const ordered = [
    ...declared.filter(tag => groups.has(tag)),
    ...[...groups.keys()].filter(tag => !declaredSet.has(tag)).sort(compareNames),
  ];
  for (const group of groups.values()) group.sort((a, b) =>
    compareNames(a.path, b.path) || rank(a.method) - rank(b.method) || compareNames(a.method, b.method));
  return { groups, ordered };
}
