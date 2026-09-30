import { runStatusName } from "../../../entities/api-testing";
import { useEffect, useRef, useState } from "react";
import type { ApiProject, ApiScope, ApiScenarioInputRequest, ApiTestingBridge, SavedApiScenario, SavedApiSuite } from "../../../../app/api-testing/shared/workspace";
import { producedGlobalNames, renderSuiteReport, reportScenario, usesInvalidatedGlobal, type SuiteReport, type SuiteReportScenario } from "../../../../app/api-testing/shared/suite-report";
import { SidebarMetadataFields } from "../../../entities/api-testing";

import { DeleteAction } from "../../../entities/api-testing";
import { SortableList } from "../../../shared/ui/SortableList";
import { RunInputModal } from "../../../features/api-testing/submit-run-input";
import { Icon } from "../../../shared/ui/Icon";

type Props = { project: ApiProject; scope: ApiScope; bridge: ApiTestingBridge; scenarios: SavedApiScenario[]; suites: SavedApiSuite[]; selectedId: string; onSuitesChange: (suites: SavedApiSuite[]) => void; onSelectedIdChange: (id: string) => void; onBusy: (busy: boolean) => void };
const message = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");
const statusName = runStatusName;
class SuiteDependencyError extends Error {}

export function SuitePanel({ project, scope, bridge, scenarios, suites, selectedId, onSuitesChange, onSelectedIdChange, onBusy }: Props) {
  const selected = suites.find(suite => suite.id === selectedId);
  const [name, setName] = useState(selected?.name ?? "");
  const [ids, setIds] = useState<string[]>(selected?.scenarioIds ?? []);
  const [groupPath, setGroupPath] = useState(selected?.groupPath ?? []);
  const [onFailure, setOnFailure] = useState<"stop" | "continue">(selected?.onFailure ?? "stop");
  // Like scenarios: a saved suite opens as a read-only view; its form shows after [수정].
  const [editing, setEditing] = useState(!selected);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<SuiteReport | null>(null);
  const [pending, setPending] = useState<ApiScenarioInputRequest | null>(null);
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
  const save = async () => {
    setError(""); setReport(null);
    try {
      const item = await bridge.saveSuite(project.id, { id: selected?.id ?? crypto.randomUUID(), name: name.trim(), scenarioIds: ids, onFailure, groupPath, ...(selected?.tags ? { tags: selected.tags } : {}) }, selected?.updatedAt);
      onSuitesChange(await bridge.listSuites(project.id)); onSelectedIdChange(item.id); setEditing(false);
    } catch (err) { setError(message(err)); }
  };
  const remove = async () => {
    if (!selected) return;
    setError("");
    await bridge.deleteSuite(project.id, selected.id, selected.updatedAt); onSuitesChange(await bridge.listSuites(project.id)); onSelectedIdChange("");
  };
  const cancel = async () => { cancelRequested.current = true; await bridge.cancel(scope); };
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
        if (cancelRequested.current) { rows.push({ id, name: item?.name ?? "삭제된 시나리오", status: rows.some(row => row.status === "cancelled") ? "skipped" : "cancelled", durationMs: 0, steps: [], reason: "스위트 실행이 취소되어 호출하지 않았습니다." }); continue; }
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
  const stopEditing = () => {
    if (!selected) return;
    setName(selected.name); setIds(selected.scenarioIds); setGroupPath(selected.groupPath ?? []); setOnFailure(selected.onFailure); setError(""); setEditing(false);
  };
  const unsaved = !selected || selected.name !== name.trim() || selected.onFailure !== onFailure || selected.scenarioIds.join("\0") !== ids.join("\0") || JSON.stringify(selected.groupPath ?? []) !== JSON.stringify(groupPath);
  return <article className="api-request-panel api-scenario-detail api-suite-panel">
      <header className="api-detail-heading"><div><h2>{selected?.name ?? "새 스위트"}</h2><p className="api-description">시나리오를 지정한 순서대로 실행하고 HTML 리포트를 받습니다.</p></div>{selected && <div className="api-actions api-detail-actions"><span className="api-action-group" role="group" aria-label="실행"><button type="button" className="api-primary" disabled={running || unsaved} title={unsaved ? "변경사항을 저장한 뒤 실행할 수 있습니다" : undefined} onClick={() => void run()}>{running ? "실행 중…" : "실행"}</button>{running && <button type="button" onClick={() => void cancel()}>실행 중단</button>}</span><span className="api-action-group" role="group" aria-label="편집"><button type="button" disabled={running || editing} onClick={() => setEditing(true)}>수정</button></span><span className="api-action-group" role="group" aria-label="관리"><DeleteAction key={selected.id} label="스위트 삭제" text="삭제" disabled={running} description={`‘${selected.name}’ 스위트를 삭제합니다. 포함된 시나리오는 유지됩니다.`} onDelete={remove} /></span></div>}</header>
      {selected && editing && unsaved && !running && <p className="api-run-notice">저장하지 않은 변경사항이 있습니다. <strong>스위트 저장</strong> 후 실행할 수 있습니다.</p>}
      {selected && !editing && <section className="api-suite-view" aria-label="스위트 구성">
        <p className="api-spec-meta">{selected.scenarioIds.length}개 시나리오 · {selected.onFailure === "stop" ? "실패하면 나머지 건너뛰기" : "실패해도 다음 시나리오 계속"}{selected.groupPath?.length ? ` · ${selected.groupPath.join(" › ")}` : ""}</p>
        <ol className="api-suite-view-list">{selected.scenarioIds.map((id, index) => <li key={`${id}:${index}`}>{scenarios.find(scenario => scenario.id === id)?.name ?? "삭제된 시나리오"}</li>)}</ol>
      </section>}
      {editing && <div className="api-suite-editor"><label>스위트 이름<input value={name} disabled={running} onChange={event => setName(event.target.value)} placeholder="예: 회원 가입부터 승인까지" /></label><SidebarMetadataFields groupPath={groupPath} existingGroupPaths={existingGroupPaths} disabled={running} onGroupPathChange={setGroupPath} /><fieldset disabled={running}><legend>실행 순서</legend><SortableList items={ids} disabled={running} className="api-suite-orders"
        itemKey={(id, index) => `${id}:${ids.slice(0, index).filter(other => other === id).length}`}
        itemLabel={(id, index) => `${index + 1}번째 ${scenarios.find(scenario => scenario.id === id)?.name ?? "삭제된 시나리오"}`}
        itemClassName={() => "api-suite-order"}
        onMove={(from, to) => { const next = [...ids]; next.splice(to, 0, ...next.splice(from, 1)); setIds(next); }}
        renderItem={(id, index, position) => { const item = scenarios.find(scenario => scenario.id === id); return <>
          <span className="api-suite-order-number">{position + 1}</span>
          <span className="api-suite-order-name">{item?.name ?? "삭제된 시나리오"}</span>
          <button type="button" className="api-suite-order-remove" title="제거" aria-label={`${index + 1}번째 ${item?.name ?? "삭제된 시나리오"} 제거`} onClick={() => setIds(ids.filter((_, i) => i !== index))}><Icon name="close" size={16} /></button>
        </>; }} /><label>시나리오 추가<select value="" onChange={event => { if (event.target.value) setIds([...ids, event.target.value]); }}><option value="">선택하세요</option>{scenarios.filter(item => !item.draft).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><small>같은 시나리오를 여러 번 추가할 수 있습니다. 각 항목을 순서대로 다시 실행합니다.</small></fieldset><label>실패 시 동작<select value={onFailure} disabled={running} onChange={event => setOnFailure(event.target.value as "stop" | "continue") }><option value="stop">중단하고 나머지 건너뛰기</option><option value="continue">다음 시나리오 계속 실행</option></select></label><div className="api-actions"><button type="button" className={unsaved ? "api-primary" : undefined} disabled={running || !name.trim() || !ids.length || !unsaved} onClick={() => void save()}>스위트 저장</button>{selected && <button type="button" disabled={running} onClick={stopEditing}>취소</button>}</div></div>}
      {running && <p role="status">{progress || "스위트 실행 준비 중…"}</p>}
      {pending && <RunInputModal key={pending.requestId} request={pending} scope={{ projectId: scope.projectId, environmentId: scope.environmentId }} bridge={bridge} context={progress.replace(/^\d+\/\d+ · /, "") || undefined} onSubmitted={() => setPending(null)} onCancel={() => { setPending(null); void cancel(); }} />}
      {error && <p className="api-warning" role="alert">{error}</p>}
      {report && <section className="api-suite-results" aria-label="스위트 실행 결과"><header className="api-run-section-heading"><div><h3>실행 결과 · {statusName(report.status)}</h3><small>{report.scenarios.length}개 시나리오 · {new Date(report.completedAt).toLocaleString()}</small></div><button type="button" disabled={running} onClick={() => void download()}>HTML 리포트 받기</button></header>{report.scenarios.map((row, index) => <details key={`${row.id}:${index}`} open={row.status !== "passed"}><summary>{index + 1}. {row.name} · {statusName(row.status)} · {row.durationMs}ms</summary>{row.reason && <p>{row.reason}</p>}<ol>{row.steps.map((step, stepIndex) => <li key={stepIndex}>{step.reference} · {statusName(step.status)}{step.httpStatus !== undefined && ` · HTTP ${step.httpStatus}`}{step.reason && ` · ${step.reason}`}{!!step.checkResults?.length && <ul className="api-suite-checks">{step.checkResults.map((check, checkIndex) => <li key={checkIndex} className={check.passed ? "is-passed" : "is-failed"}>{check.passed ? "✓" : "✗"} {check.label}</li>)}</ul>}</li>)}</ol></details>)}</section>}
    </article>;
}
