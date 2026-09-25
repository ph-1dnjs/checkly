import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiProject, ApiScope, ApiScenarioInputRequest, ApiTestingBridge, SavedApiScenario, SavedApiSuite } from "../../../app/api-testing/shared/workspace";
import { type Json } from "../../../app/api-testing/shared/scenario";
import { producedGlobalNames, renderSuiteReport, reportScenario, usesInvalidatedGlobal, type SuiteReport, type SuiteReportScenario } from "../../../app/api-testing/shared/suite-report";
import { SidebarMetadataFields } from "./SidebarMetadataFields";
import { useSensitiveValues } from "./sensitive-values";

type Props = { project: ApiProject; scope: ApiScope; bridge: ApiTestingBridge; scenarios: SavedApiScenario[]; suites: SavedApiSuite[]; selectedId: string; onSuitesChange: (suites: SavedApiSuite[]) => void; onSelectedIdChange: (id: string) => void; onBusy: (busy: boolean) => void };
const message = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");
const statusName = (status: string) => ({ passed: "통과", failed: "실패", blocked: "설정 필요", cancelled: "취소", skipped: "건너뜀" })[status as "passed"] ?? status;
class SuiteDependencyError extends Error {}

export function SuitePanel({ project, scope, bridge, scenarios, suites, selectedId, onSuitesChange, onSelectedIdChange, onBusy }: Props) {
  const selected = suites.find(suite => suite.id === selectedId);
  const sensitiveValues = useSensitiveValues();
  const [name, setName] = useState(selected?.name ?? "");
  const [ids, setIds] = useState<string[]>(selected?.scenarioIds ?? []);
  const [groupPath, setGroupPath] = useState(selected?.groupPath ?? []);
  const [onFailure, setOnFailure] = useState<"stop" | "continue">(selected?.onFailure ?? "stop");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<SuiteReport | null>(null);
  const [pending, setPending] = useState<ApiScenarioInputRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const groupPathMap = new Map<string, string[]>();
  for (const item of [...scenarios, ...suites]) for (let depth = 1; depth <= (item.groupPath?.length ?? 0); depth++) {
    const path = item.groupPath!.slice(0, depth);
    groupPathMap.set(JSON.stringify(path), path);
  }
  const existingGroupPaths = [...groupPathMap.values()];
  const cancelRequested = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!running) { setPending(null); return; }
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try { const next = await bridge.getPendingScenarioInput({ projectId: scope.projectId, environmentId: scope.environmentId }); if (active) setPending(next); }
      catch { /* A completed run may close the pending input simultaneously. */ }
      finally { if (active) timer = window.setTimeout(() => void poll(), 250); }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [bridge, running, scope.projectId, scope.environmentId]);
  useEffect(() => setInputValue(""), [pending?.requestId]);
  const save = async () => {
    setError(""); setReport(null);
    try {
      const item = await bridge.saveSuite(project.id, { id: selected?.id ?? crypto.randomUUID(), name: name.trim(), scenarioIds: ids, onFailure, groupPath, ...(selected?.tags ? { tags: selected.tags } : {}) }, selected?.updatedAt);
      onSuitesChange(await bridge.listSuites(project.id)); onSelectedIdChange(item.id);
    } catch (err) { setError(message(err)); }
  };
  const remove = async () => {
    if (!selected || !window.confirm(`‘${selected.name}’ 스위트를 삭제할까요? 시나리오는 유지됩니다.`)) return;
    setError("");
    try { await bridge.deleteSuite(project.id, selected.id, selected.updatedAt); onSuitesChange(await bridge.listSuites(project.id)); onSelectedIdChange(""); }
    catch (err) { setError(message(err)); }
  };
  const move = (index: number, offset: number) => {
    const next = [...ids]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setIds(next);
  };
  const cancel = async () => { cancelRequested.current = true; await bridge.cancel(scope); };
  const submitInput = async (event: FormEvent) => {
    event.preventDefault(); if (!pending) return;
    try {
      const value: Json = pending.type === "string" ? inputValue : JSON.parse(inputValue) as Json;
      await bridge.submitScenarioInput({ projectId: scope.projectId, environmentId: scope.environmentId }, { requestId: pending.requestId, runId: pending.runId, stepId: pending.stepId, name: pending.name, value });
      setPending(null); setError("");
    } catch (err) { setError(err instanceof SyntaxError ? "JSON 형식으로 입력하세요" : message(err)); }
  };
  const run = async () => {
    if (!selected) return;
    setRunning(true); onBusy(true); setError(""); setReport(null); cancelRequested.current = false;
    const startedAt = new Date().toISOString();
    const rows: SuiteReportScenario[] = [];
    const invalidatedGlobals = new Set<string>();
    try {
      // Re-read saved scenarios; a deleted or changed reference must not silently run a stale copy.
      const current = await bridge.listScenarios(project.id);
      for (const [index, id] of selected.scenarioIds.entries()) {
        const item = current.find(scenario => scenario.id === id);
        if (cancelRequested.current) { rows.push({ id, name: item?.name ?? "삭제된 시나리오", status: rows.some(row => row.status === "cancelled") ? "skipped" : "cancelled", durationMs: 0, steps: [], reason: "묶음 실행이 취소되어 호출하지 않았습니다." }); continue; }
        if (rows.some(row => row.status !== "passed") && selected.onFailure === "stop") {
          rows.push({ id, name: item?.name ?? "삭제된 시나리오", status: "skipped", durationMs: 0, steps: [], reason: "앞 시나리오가 통과하지 않아 호출하지 않았습니다." }); continue;
        }
        setProgress(`${index + 1}/${selected.scenarioIds.length} · ${item?.name ?? "삭제된 시나리오"}`);
        if (!item || item.draft) { rows.push({ id, name: item?.name ?? "삭제된 시나리오", status: "blocked", durationMs: 0, steps: [], reason: "시나리오가 삭제되었거나 초안입니다." }); setReport({ suiteName: selected.name, projectName: project.name, environmentName: project.environments.find(env => env.id === scope.environmentId)?.name ?? "", startedAt, completedAt: new Date().toISOString(), status: "blocked", scenarios: [...rows] }); continue; }
        const began = performance.now();
        let producedGlobals: string[] = [];
        try {
          // Preflight is intentionally per scenario: previous scenarios may create auth globals.
          const preview = await bridge.previewScenario({ projectId: scope.projectId, environmentId: scope.environmentId }, item.source, item.bindings);
          producedGlobals = producedGlobalNames(preview.scenario);
          if (usesInvalidatedGlobal(preview.scenario, invalidatedGlobals)) throw new SuiteDependencyError("앞 시나리오에서 필요한 전역변수 생성이 실패했습니다. 이전 실행의 값은 재사용하지 않습니다.");
          if (preview.issues.length || preview.executionIssues?.length) throw new Error([...preview.issues, ...(preview.executionIssues ?? [])].join("\n"));
          if (cancelRequested.current) throw new Error("실행 취소");
          const catalogs = Object.fromEntries(await Promise.all([...new Set(preview.scenario.steps.map(step => step.server))].map(async serverId => [serverId, await bridge.getCatalog({ projectId: scope.projectId, environmentId: scope.environmentId, serverId })] as const)));
          const result = await bridge.runScenario({ projectId: scope.projectId, environmentId: scope.environmentId }, item.source, item.bindings, {});
          sensitiveValues.refresh();
          const references = preview.scenario.steps.map(step => {
            const operation = catalogs[step.server]?.operations.find(candidate => "operationId" in step.api ? candidate.operationId === step.api.operationId : candidate.method === step.api.method && candidate.path === step.api.path);
            return { name: step.name ?? operation?.summary ?? step.id, reference: operation ? `${operation.method.toUpperCase()} ${operation.path}` : "operationId" in step.api ? step.api.operationId : `${step.api.method} ${step.api.path}` };
          });
          rows.push(reportScenario(id, item.name, result, references, Math.round(performance.now() - began), preview.scenario));
          if (result.status !== "passed") producedGlobals.forEach(name => invalidatedGlobals.add(name));
        } catch (err) {
          // Keep the concrete preflight reason in the app, never in the exported HTML.
          if (live.current) setError(`${item.name}: ${message(err)}`);
          rows.push({ id, name: item.name, status: cancelRequested.current ? "cancelled" : "blocked", durationMs: Math.round(performance.now() - began), steps: [], reason: err instanceof SuiteDependencyError ? "앞 시나리오의 전역변수 생성 실패로 실행하지 않았습니다." : "실행 전 설정 또는 입력을 확인하세요." });
          producedGlobals.forEach(name => invalidatedGlobals.add(name));
        }
        const status = rows.some(row => row.status === "cancelled") ? "cancelled" : rows.some(row => row.status === "failed") ? "failed" : rows.some(row => row.status === "blocked") ? "blocked" : "passed";
        if (live.current) setReport({ suiteName: selected.name, projectName: project.name, environmentName: project.environments.find(env => env.id === scope.environmentId)?.name ?? "", startedAt, completedAt: new Date().toISOString(), status, scenarios: [...rows] });
      }
      const status = rows.some(row => row.status === "cancelled") ? "cancelled" : rows.some(row => row.status === "failed") ? "failed" : rows.some(row => row.status === "blocked") ? "blocked" : "passed";
      if (live.current) setReport({ suiteName: selected.name, projectName: project.name, environmentName: project.environments.find(env => env.id === scope.environmentId)?.name ?? "", startedAt, completedAt: new Date().toISOString(), status, scenarios: rows });
    } catch (err) { if (live.current) setError(message(err)); }
    finally {
      if (live.current) { setRunning(false); setProgress(""); setPending(null); }
      onBusy(false);
    }
  };
  const download = async () => {
    if (!report || running) return;
    try { await bridge.saveSuiteReport(`checkly-api-report-${new Date(report.startedAt).toISOString().replace(/[:.]/g, "-")}.html`, renderSuiteReport(report)); }
    catch (err) { setError(message(err)); }
  };
  return <article className="api-request-panel api-scenario-detail api-suite-panel">
      <header className="api-detail-heading"><div><h2>{selected?.name ?? "새 스위트"}</h2><p className="api-description">시나리오를 지정한 순서대로 실행하고 HTML 리포트를 받습니다.</p></div></header>
      <div className="api-suite-editor"><label>스위트 이름<input value={name} disabled={running} onChange={event => setName(event.target.value)} placeholder="예: 회원 가입부터 승인까지" /></label><SidebarMetadataFields groupPath={groupPath} existingGroupPaths={existingGroupPaths} disabled={running} onGroupPathChange={setGroupPath} /><fieldset disabled={running}><legend>실행 순서</legend>{ids.map((id, index) => { const item = scenarios.find(scenario => scenario.id === id); return <div className="api-suite-order" key={`${id}:${index}`}><span>{index + 1}. {item?.name ?? "삭제된 시나리오"}</span><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${index + 1}번째 ${item?.name} 위로`}>↑</button><button type="button" disabled={index === ids.length - 1} onClick={() => move(index, 1)} aria-label={`${index + 1}번째 ${item?.name} 아래로`}>↓</button><button type="button" aria-label={`${index + 1}번째 ${item?.name} 제거`} onClick={() => setIds(ids.filter((_, position) => position !== index))}>제거</button></div>; })}<label>시나리오 추가<select value="" onChange={event => { if (event.target.value) setIds([...ids, event.target.value]); }}><option value="">선택하세요</option>{scenarios.filter(item => !item.draft).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><small>같은 시나리오를 여러 번 추가할 수 있습니다. 각 항목을 순서대로 다시 실행합니다.</small></fieldset><label>실패 시 동작<select value={onFailure} disabled={running} onChange={event => setOnFailure(event.target.value as "stop" | "continue") }><option value="stop">중단하고 나머지 건너뛰기</option><option value="continue">다음 시나리오 계속 실행</option></select></label><div className="api-actions"><button type="button" disabled={running || !name.trim() || !ids.length} onClick={() => void save()}>스위트 저장</button>{selected && <button type="button" disabled={running} onClick={() => void remove()}>스위트 삭제</button>}<button type="button" className="api-primary" disabled={running || !selected || selected.name !== name.trim() || selected.onFailure !== onFailure || selected.scenarioIds.join("\0") !== ids.join("\0") || JSON.stringify(selected.groupPath ?? []) !== JSON.stringify(groupPath)} onClick={() => void run()}>{running ? "실행 중…" : "스위트 실행"}</button>{running && <button type="button" onClick={() => void cancel()}>실행 취소</button>}</div></div>
      {running && <p role="status">{progress || "스위트 실행 준비 중…"}</p>}
      {pending && <form className="api-suite-input" onSubmit={event => void submitInput(event)}><strong>{pending.index + 1}단계 · {pending.label ?? pending.name} 입력</strong><label>{pending.name}{pending.required && " *"}<input autoComplete="off" data-value-visibility={pending.sensitive ? "sensitive" : undefined} type="text" value={inputValue} onChange={event => setInputValue(event.target.value)} /></label><button type="submit">입력하고 계속</button></form>}
      {error && <p className="api-warning" role="alert">{error}</p>}
      {report && <section className="api-suite-results" aria-label="묶음 실행 결과"><header className="api-run-section-heading"><div><h3>실행 결과 · {statusName(report.status)}</h3><small>{report.scenarios.length}개 시나리오 · {new Date(report.completedAt).toLocaleString()}</small></div><button type="button" disabled={running} onClick={() => void download()}>HTML 리포트 받기</button></header>{report.scenarios.map((row, index) => <details key={`${row.id}:${index}`} open={row.status !== "passed"}><summary>{index + 1}. {row.name} · {statusName(row.status)} · {row.durationMs}ms</summary>{row.reason && <p>{row.reason}</p>}<ol>{row.steps.map((step, stepIndex) => <li key={stepIndex}>{step.reference} · {statusName(step.status)}{step.httpStatus !== undefined && ` · HTTP ${step.httpStatus}`}{step.reason && ` · ${step.reason}`}</li>)}</ol></details>)}</section>}
    </article>;
}
