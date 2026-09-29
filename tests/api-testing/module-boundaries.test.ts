import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const renderer = path.resolve("src/renderer");
const sharedContracts = path.resolve("src/app/api-testing/shared");
const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? files(file) : /\.tsx?$/.test(entry.name) ? [file] : [];
});
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
const rank: Record<string, number> = { shared: 0, entities: 1, features: 2, widgets: 3, pages: 4, app: 5 };
const relative = (file: string) => path.relative(renderer, file).split(path.sep).join("/");
const slice = (file: string) => {
  const parts = relative(file).split("/");
  return parts.slice(0, parts[0] === "features" ? 3 : 2).join("/");
};
const scoped = (file: string) => /^(entities|features|pages)\/api-testing\//.test(relative(file)) || [
  "shared/hooks/useRunAction.ts", "shared/model/run-action.ts", "shared/ui/DraftFields.tsx", "shared/ui/SortableList.tsx",
].includes(relative(file));

function importGraph() {
  const graph = new Map<string, string[]>();
  const violations: string[] = [];
  for (const file of files(renderer)) {
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const edges: string[] = [];
    const visit = (node: ts.Node) => {
      const module = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
      if (module && ts.isStringLiteral(module)) {
        const specifier = module.text;
        const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
        // TypeScript returns forward slashes even when filesystem paths use backslashes.
        const target = resolved && path.normalize(resolved);
        if (target?.startsWith(renderer + path.sep)) {
          edges.push(target);
          if (scoped(file)) {
            const from = relative(file).split("/")[0], to = relative(target).split("/")[0];
            if (rank[from] < rank[to]) violations.push(`${relative(file)} imports upper layer ${relative(target)}`);
            if (from === "features" && to === "features" && slice(file) !== slice(target)) violations.push(`${relative(file)} imports another feature ${relative(target)}`);
            if (["entities", "features"].includes(to) && slice(file) !== slice(target) && path.basename(target) !== "index.ts") violations.push(`${relative(file)} bypasses public API ${relative(target)}`);
          }
        } else if (scoped(file) && specifier.startsWith(".")) {
          if (!target && !specifier.endsWith(".css")) violations.push(`${relative(file)} has unresolved import ${specifier}`);
          if (target && !target.startsWith(sharedContracts + path.sep)) violations.push(`${relative(file)} crosses process boundary ${specifier}`);
        } else if (scoped(file) && specifier.startsWith("@/") && !target && !specifier.endsWith(".css")) {
          violations.push(`${relative(file)} has unresolved alias ${specifier}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    graph.set(file, edges);
  }
  return { graph, violations };
}

test("API testing renderer respects layer, feature, public API and process boundaries", () => {
  const { violations } = importGraph();
  assert.deepEqual(violations, []);
});

test("API testing renderer imports do not introduce cycles, including type imports", () => {
  const { graph } = importGraph();
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const visit = (file: string) => {
    assert.ok(!active.has(file), `Import cycle: ${[...stack, file].map(relative).join(" → ")}`);
    if (visited.has(file)) return;
    active.add(file); stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop(); active.delete(file); visited.add(file);
  };
  for (const file of graph.keys()) if (scoped(file)) visit(file);
});
