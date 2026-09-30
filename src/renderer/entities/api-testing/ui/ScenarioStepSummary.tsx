import type { ReactNode } from "react";
import type { Scenario } from "../../../../app/api-testing/shared/scenario";
import type { ApiCatalog } from "../../../../app/api-testing/shared/workspace";
import { configuredFields } from "../lib/settings-summary-model";
import { SummaryJson } from "./SummaryJson";
import { responseFields } from "../lib/response-fields";
import { GlobalVariableSetupLink } from "./GlobalVariableSetupLink";
import { expectedValueText, verificationOperatorLabels, verificationSourceLabels } from "../../../../app/api-testing/shared/scenario";

const jsonKind = (value: unknown) => value === null ? "null" : typeof value === "string" ? "string" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";

type ApiOperation = ApiCatalog["operations"][number];

export type ScenarioStepSummaryProps = {
  scenario: Scenario;
  stepIndex: number;
  operation?: ApiOperation;
  catalog?: ApiCatalog | null;
  globals?: Set<string> | null;
  missingGlobals?: Set<string>;
  onConfigureGlobal: (name: string) => void;
  onSelect?: (stepId: string, field?: string) => void;
};

export function ScenarioStepSummary({ scenario, stepIndex, operation, catalog, globals, missingGlobals = new Set(), onSelect, onConfigureGlobal }: ScenarioStepSummaryProps) {
  const step = scenario.steps[stepIndex];
  const auth = step.auth === "none" ? undefined : step.auth ?? scenario.auth;
  const fieldOrder = new Map<string, number>();
  const areaForParameter = (location: string) => location === "path" ? "pathParams" : location === "header" ? "headers" : location === "cookie" ? "cookies" : "query";
  (operation?.parameters ?? []).forEach((parameter, parameterIndex) => fieldOrder.set(`${areaForParameter(parameter.location)}:${parameter.name}`, parameterIndex));
  const bodyProperties = operation?.bodySchema && typeof operation.bodySchema === "object" && !Array.isArray(operation.bodySchema) && operation.bodySchema.properties && typeof operation.bodySchema.properties === "object" ? Object.keys(operation.bodySchema.properties) : [];
  bodyProperties.forEach((name, propertyIndex) => fieldOrder.set(`body:${name}`, (operation?.parameters.length ?? 0) + propertyIndex));
  const fields = configuredFields(scenario, stepIndex).sort((a, b) => {
    const aKey = `${a.path[0]}:${a.path.slice(1).join(".")}`;
    const bKey = `${b.path[0]}:${b.path.slice(1).join(".")}`;
    return (fieldOrder.get(aKey) ?? Number.MAX_SAFE_INTEGER) - (fieldOrder.get(bKey) ?? Number.MAX_SAFE_INTEGER);
  });
  const availableGlobals = new Set(globals ?? []);
  scenario.steps.slice(0, stepIndex).forEach(previous => previous.extract.forEach(extract => { if (extract.target.startsWith("globals.")) availableGlobals.add(extract.target.slice(8)); }));
  const isMissingGlobal = (field: typeof fields[number]) => Boolean(field.global && (missingGlobals.has(field.global) || (globals && !availableGlobals.has(field.global))));
  const action = (content: ReactNode, className: string, onClick?: () => void, label?: string) => onClick
    ? <button type="button" className={className} onClick={onClick} aria-label={label}>{content}</button>
    : <span className={className}>{content}</span>;
  const fieldContent = (field: typeof fields[number]) => {
    const value = field.direct
      ? <span className={`api-json-syntax-${jsonKind(field.value)}`}>{JSON.stringify(field.value) ?? "null"}</span>
      : <span className={`api-field-state api-field-state-${field.global ? "global" : field.label === "실행 중 입력" ? "user-input" : "scenario"}`}><strong>{field.global ? "전역변수" : field.label === "실행 중 입력" ? "사용자 입력" : "값 연결"}</strong>{field.label !== "실행 중 입력" && <code>{field.global ?? field.label}</code>}</span>;
    return <>{action(value, "api-json-token api-summary-value", onSelect ? () => onSelect(step.id, field.key) : undefined, `${field.field} 설정`)}{isMissingGlobal(field) ? <GlobalVariableSetupLink onConfigure={onConfigureGlobal} name={field.global!} /> : field.warning && <span className="api-response-json-badge is-verify" role="status">{field.warning}</span>}</>;
  };
  return <>
    {(auth || step.auth === "none") && <p className="api-field-help">인증: {auth ? `Bearer · ${auth.slice(8)}${step.auth ? " (개별 설정)" : " (기본값)"}` : "없음 (개별 설정)"}</p>}
    {!auth && step.auth !== "none" && !fields.length && !step.extract.length && !step.expect?.length && <p>설정 없음</p>}
    {!!fields.length && <><h4 data-summary-area="request" tabIndex={-1}>요청</h4><SummaryJson knownPaths={[
      ...Object.keys(operation?.bodyExample && typeof operation.bodyExample === "object" && !Array.isArray(operation.bodyExample) ? operation.bodyExample : {}).map(key => ["body", key]),
      ...(operation?.parameters ?? []).map(parameter => [parameter.location, parameter.name]),
    ]} entries={fields.map(field => ({ path: field.path, content: fieldContent(field) }))} /></>}
    {!!step.extract.length && <><h4 data-summary-area="response" tabIndex={-1}>응답에서 저장</h4><SummaryJson knownPaths={operation ? responseFields(operation.responses, catalog?.spec).filter(field => /^2/.test(field.status)).map(field => field.pointer.split("/").slice(1).map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))) : []} entries={step.extract.map(extract => {
      const isGlobal = extract.target.startsWith("globals.");
      const target = isGlobal ? extract.target.slice(8) : extract.target.replace(/^vars\./, "");
      const responseField = extract.pointer !== undefined ? `response:${extract.source ?? "body"}:${extract.pointer}` : `response:header:${extract.header ?? "응답"}`;
      const badgeClass = `api-response-json-badge ${isGlobal ? "is-global" : "is-save"}`;
      const badgeLabel = isGlobal ? "전역변수 저장" : "값 저장";
      const content = onSelect
        ? <button type="button" className={badgeClass} title={`${badgeLabel} → ${target}`} aria-label={`${badgeLabel}: ${target}`} onClick={() => onSelect(step.id, responseField)}>{badgeLabel} → <code>{target}</code></button>
        : <span className={badgeClass} title={`${badgeLabel} → ${target}`}>{badgeLabel} → <code>{target}</code></span>;
      return { path: extract.pointer !== undefined ? extract.pointer.split("/").slice(1).map(part => part.replace(/~1/g, "/").replace(/~0/g, "~")) : [extract.header ?? "응답"], content };
    })} /></>}
    {!!step.expect?.length && <><h4 data-summary-area="expect" tabIndex={-1}>검증</h4><ul className="api-summary-checks">{step.expect.map((expect, index) => <li key={index}>{action(<>
      <span className="api-summary-check-target">{expect.source === "status" ? verificationSourceLabels.status : <code>{expect.source === "header" ? expect.header : expect.pointer || "전체 응답"}</code>}</span>
      <span className="api-summary-check-operator">{verificationOperatorLabels[expect.operator]}</span>
      {expect.operator !== "exists" && <code className={`api-json-syntax-${jsonKind(expect.value)}`}>{expectedValueText(expect.value)}</code>}
    </>, "api-summary-check", onSelect ? () => onSelect(step.id) : undefined, "검증 설정")}</li>)}</ul></>}
  </>;
}
