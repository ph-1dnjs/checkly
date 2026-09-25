import { scenarioStepInputs, scenarioStepLabel, type Json, type Scenario } from "../../../app/api-testing/shared/scenario";

type FlowEndpoint = { method: string; path: string };

// Mermaid syntax must never be taken from API descriptions, values, or user labels.
const label = (value: string) => value.slice(0, 160).replace(/[^\p{L}\p{N} _./-]/gu, char => `#${char.codePointAt(0)};`).replace(/[\r\n]/g, " ");

const areas: Record<string, string> = { body: "Body", headers: "Headers", header: "Headers", query: "Query", pathParams: "Path", cookies: "Cookies" };
const pointerName = (pointer?: string) => pointer || "전체";

function jsonSummary(rows: string[]): string[] {
  const root: Record<string, any> = Object.create(null);
  for (const row of new Set(rows)) {
    const separator = row.includes(" ← ") ? " ← " : row.includes(" → ") ? " → " : " · ";
    const offset = row.indexOf(separator);
    const path = row.slice(0, offset).replace(/^Body(?: |\/)/, "").replace(/^(Headers|Query|Path|Cookies) /, "$1/");
    const keys = path.split("/").filter(Boolean).map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"));
    let target = root;
    for (const key of keys.slice(0, -1)) {
      if (typeof target[key] !== "object" || target[key] === null) target[key] = Object.assign(Object.create(null), target[key] ? { 설정: target[key] } : {});
      target = target[key];
    }
    const key = keys.at(-1) ?? "전체";
    const value = row.slice(offset + separator.length);
    if (target[key] && typeof target[key] === "object") target[key].설정 = [target[key].설정, value].filter(Boolean).join(" · ");
    else target[key] = target[key] ? `${target[key]} · ${value}` : value;
  }
  return JSON.stringify(root, null, 2).split("\n");
}

/** Summaries contain configuration and references, never request values or expected values. */
function summaries(scenario: Scenario) {
  const requests: string[][] = scenario.steps.map(() => []);
  const responses: string[][] = scenario.steps.map(() => []);
  scenario.steps.forEach((step, index) => {
    const visit = (value: Json, path: string) => {
      if (value && typeof value === "object" && Object.keys(value).length) {
        Object.entries(value).forEach(([key, child]) => visit(child, `${path}/${key}`));
        return;
      }
      const refs = typeof value === "string" ? [...value.matchAll(/\{\{(inputs|vars|globals)\.([A-Za-z][A-Za-z0-9_]*)\}\}/g)] : [];
      const sources = refs.map(([, scope, name]) => {
        if (scope === "globals") return `전역변수 ${name}`;
        const binding = scope === "vars" ? scenario.valueBindings.find(item => item.name === name) : undefined;
        let sourceIndex = binding ? scenario.steps.findIndex(item => item.id === binding.step) : -1;
        let source = binding ? `${binding.source === "response" ? "응답" : "요청"} ${areas[binding.area]} ${pointerName(binding.pointer ?? binding.header)}` : "";
        if (!binding && scope === "vars") {
          for (let previous = index - 1; previous >= 0; previous--) {
            const extraction = scenario.steps[previous].extract.find(item => item.target === `vars.${name}`);
            if (extraction) { sourceIndex = previous; source = `응답 ${areas[extraction.source]} ${pointerName(extraction.pointer ?? extraction.header)}`; break; }
          }
        }
        if (sourceIndex >= 0) {
          return `${sourceIndex + 1}단계 ${source}`;
        }
        if (scope === "inputs" || scenario.steps.slice(0, index + 1).some(item => scenarioStepInputs(item).some(input => input.name === name)) || scenario.inputs[name]) return name === path.split("/").at(-1) ? "사용자 입력" : `사용자 입력 ${name}`;
        return `시나리오 값 ${name}`;
      });
      requests[index].push(`${path} ← ${sources.length ? [...new Set(sources)].join(", ") : "직접 입력"}`);
    };
    Object.entries(step.request).forEach(([area, value]) => {
      if (value === undefined || (area !== "body" && value && typeof value === "object" && !Object.keys(value).length)) return;
      visit(value, areas[area] ?? area);
    });
    step.extract.forEach(item => {
      if (item.target.startsWith("globals.")) responses[index].push(`${areas[item.source]} ${pointerName(item.pointer ?? item.header)} → 전역변수 ${item.target.slice(8)} 저장`);
    });
    step.expect?.forEach(item => responses[index].push(`${item.source === "status" ? "HTTP 상태" : `${areas[item.source]} ${pointerName(item.pointer ?? item.header)}`} · ${item.operator === "exists" ? "존재 검증" : item.operator === "equals" ? "일치 검증" : "포함 검증"}`));
  });
  return { requests, responses };
}

export function scenarioFlow(scenario: Scenario, resolveEndpoint?: (step: Scenario["steps"][number]) => FlowEndpoint | undefined): string {
  const lines = [
    '%%{init: {"flowchart": {"rankSpacing": 12, "nodeSpacing": 12, "padding": 8, "diagramPadding": 4}}}%%',
    "flowchart TD",
  ];
  const { requests, responses } = summaries(scenario);
  const box = (id: string, title: string, rows: string[], tone: string) => {
    if (!rows.length) return;
    lines.push(`${id}["${[title, ...jsonSummary(rows)].map(label).join("<br/>")}"]`, `class ${id} ${tone}`);
  };
  scenario.steps.forEach((step, index) => {
    const endpoint = resolveEndpoint?.(step);
    const method = endpoint?.method.toUpperCase() ?? ("method" in step.api ? step.api.method : "API");
    const api = endpoint
      ? `${endpoint.method.toUpperCase()} ${endpoint.path}`
      : "operationId" in step.api ? step.api.operationId : `${step.api.method} ${step.api.path}`;
    lines.push(`subgraph stage${index}["${index + 1}단계"]`, "direction TB");
    box(`req${index}`, "요청", requests[index], "request");
    lines.push(`s${index}["${label(`${index + 1}. ${api}${step.name ? ` · ${scenarioStepLabel(step)}` : ""}`)}"]`, `class s${index} ${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method) ? method : "endpoint"}`);
    box(`res${index}`, "응답", responses[index], "response");
    if (requests[index].length) lines.push(`req${index} ~~~ s${index}`);
    if (responses[index].length) lines.push(`s${index} ~~~ res${index}`);
    lines.push("end", `style stage${index} fill:#ffffff,stroke:#9baeb8,stroke-width:1px,stroke-dasharray:5 5,rx:12,ry:12`);
  });
  scenario.steps.forEach((_, index) => { if (index) lines.push(`stage${index - 1} ==> stage${index}`); });
  lines.push(
    "classDef request fill:#fffdf7,stroke:none,color:#594516,font-size:12px,font-family:monospace",
    "classDef response fill:#faf7fd,stroke:none,color:#493565,font-size:12px,font-family:monospace",
    "classDef GET fill:#ebf5ff,stroke:#61affe,stroke-width:2.5px,color:#153d62",
    "classDef POST fill:#eaf8f1,stroke:#49cc90,stroke-width:2.5px,color:#164d34",
    "classDef PUT fill:#fff4e7,stroke:#fca130,stroke-width:2.5px,color:#734208",
    "classDef PATCH fill:#e8faf6,stroke:#50e3c2,stroke-width:2.5px,color:#155d50",
    "classDef DELETE fill:#fff0f0,stroke:#f93e3e,stroke-width:2.5px,color:#7e2020",
    "classDef HEAD fill:#f4effc,stroke:#9012fe,stroke-width:2.5px,color:#502c78",
    "classDef OPTIONS fill:#edf4fc,stroke:#0d5aa7,stroke-width:2.5px,color:#234c76",
    "classDef endpoint fill:#e5f2fa,stroke:#17607f,stroke-width:2.5px,color:#123c52,font-weight:bold",
  );
  return lines.join("\n");
}
