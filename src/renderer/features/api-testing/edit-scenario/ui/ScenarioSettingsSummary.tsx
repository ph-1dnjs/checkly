import { useEffect, useRef, useState } from "react";
import { type Scenario } from "../../../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";
import { ScenarioStepSummary, ServerTag, usesManyServers } from "../../../../entities/api-testing";


export function ScenarioSettingsSummary({ scenario, catalogs, projectId, bridge, onSelect, globalRevision, onConfigureGlobal, serverNames = {} }: { serverNames?: Record<string, string>; globalRevision: number; onConfigureGlobal: (name: string) => void; scenario: Scenario; catalogs: Record<string, ApiCatalog | null>; projectId: string; bridge: ApiTestingBridge; onSelect: (id: string) => void }) {
  const [globals, setGlobals] = useState<Set<string> | null>(null);
  const pending = useRef<MutationObserver | null>(null);
  useEffect(() => () => pending.current?.disconnect(), []);
  useEffect(() => {
    let live = true;
    void bridge.listGlobals({ projectId }).then(items => { if (live) setGlobals(new Set(items.filter(v => v.displayValue !== "" && v.displayValue !== "null").map(v => v.name))); }).catch(() => { if (live) setGlobals(null); });
    return () => { live = false; };
  }, [projectId, bridge, globalRevision]);
  const focus = (id: string, field?: string) => {
    pending.current?.disconnect(); onSelect(id);
    const step = document.getElementById(`scenario-editor-step-${id}`);
    if (!(step instanceof HTMLDetailsElement)) return;
    step.open = true;
    const locate = () => {
      const target = field ? [...step.querySelectorAll<HTMLElement>("[data-summary-field]")].find(el => el.dataset.summaryField === field) : step;
      if (!target) return false;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.querySelector<HTMLElement>("input,textarea,button,summary")?.focus({ preventScroll: true });
      target.animate([{ outline: "2px solid #17607f" }, { outline: "2px solid transparent" }], { duration: 1600 });
      return true;
    };
    if (!locate()) {
      const observer = new MutationObserver(() => { if (locate()) observer.disconnect(); });
      observer.observe(step, { childList: true, subtree: true }); pending.current = observer;
    }
  };
  // Always shown: the pane is resized instead of folded.
  return <section className="api-settings-summary" aria-labelledby="api-settings-summary-title"><h3 id="api-settings-summary-title" className="api-settings-summary-title">설정 요약</h3><div>
    {scenario.steps.map((step, index) => {
      const op = catalogs[step.server]?.operations.find(o => "operationId" in step.api ? o.operationId === step.api.operationId : o.path === step.api.path && o.method.toUpperCase() === step.api.method);
      const method = op?.method ?? ("method" in step.api ? step.api.method : "API");
      const path = op?.path ?? ("path" in step.api ? step.api.path : step.api.operationId);
      return <section key={step.id} className={`api-summary-card api-selected-${method.toLowerCase()}`}>
        <button type="button" className="api-summary-heading" onClick={() => focus(step.id)}><span>{index + 1}</span><span className="api-method" data-method={method}>{method}</span><code>{path}</code>{usesManyServers(scenario.steps) && <ServerTag server={step.server} names={serverNames} />}</button>
        <div className="api-summary-content"><ScenarioStepSummary onConfigureGlobal={onConfigureGlobal} scenario={scenario} stepIndex={index} operation={op} catalog={catalogs[step.server]} globals={globals} onSelect={focus} /></div>
      </section>;
    })}
  </div></section>;
}
