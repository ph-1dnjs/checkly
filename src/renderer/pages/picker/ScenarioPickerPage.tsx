import { useMemo, useState } from "react";
import { actionText, parseMarkdown, type MarkerPositionStore, type Scenario } from "../../shared/model/scenario";
import type { WebScenarioRecord } from "../../../app/ipc/web-scenario/types";
import { ActionTag } from "../../shared/ui/ActionTag";
import { Button } from "../../shared/ui/Button";
import { LoadingSpinner } from "../../shared/ui/LoadingSpinner";
import { ScenarioList } from "../../widgets/ScenarioList";

type Props = {
  records: WebScenarioRecord[];
  loading: boolean;
  pickedKeys: Set<string>;
  onPick: (keys: Set<string>) => void;
  onOpenEditor: () => void;
  onRun: (scenarios: Scenario[]) => void;
};
export const recordScenarios = (record: WebScenarioRecord): Scenario[] => {
  const positions = JSON.parse(record.positions) as MarkerPositionStore;
  return parseMarkdown(record.markdown, record.id).map(scenario => {
    const points = [...(positions[scenario.id] ?? positions[`${scenario.title}\n${scenario.url}`] ?? [])];
    return { ...scenario, steps: scenario.steps.map(step => {
      const index = points.findIndex(item => item.databaseId && step.databaseId ? item.databaseId === step.databaseId :
        item.action === step.action && item.target === step.target && item.value === step.value &&
        item.prompt === step.prompt && item.condition === step.condition && item.waitSeconds === step.waitSeconds && (item.occurrence ?? 1) === (step.occurrence ?? 1));
      return { ...step, ...(index < 0 ? undefined : points.splice(index, 1)[0]), id: step.id };
    }) };
  });
};
export const ScenarioPickerPage = ({ records, loading, pickedKeys, onPick, onOpenEditor, onRun }: Props) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const groups = useMemo(() => records.map(record => ({ record, scenarios: recordScenarios(record) })), [records]);
  const activeGroup = groups.find(group => group.record.id === activeId) ?? groups[0];
  const activeRecord = activeGroup?.record;
  const activeScenarios = activeGroup?.scenarios ?? [];
  const pickedGroups = groups.map(group => ({ ...group, scenarios: group.scenarios.filter(scenario => pickedKeys.has(scenario.id)) })).filter(group => group.scenarios.length);
  const picked = pickedGroups.flatMap(group => group.scenarios);
  const pickedCountByRecord = Object.fromEntries(pickedGroups.map(group => [group.record.id, group.scenarios.length]));
  const allActivePicked = activeScenarios.length > 0 && activeScenarios.every(scenario => pickedKeys.has(scenario.id));
  const someActivePicked = activeScenarios.some(scenario => pickedKeys.has(scenario.id));
  const togglePickAll = () => {
    const next = new Set(pickedKeys);
    for (const scenario of activeScenarios) {
      allActivePicked ? next.delete(scenario.id) : next.add(scenario.id);
    }
    onPick(next);
  };
  const togglePick = (id: string) => {
    const next = new Set(pickedKeys);
    next.has(id) ? next.delete(id) : next.add(id);
    onPick(next);
  };
  const toggleExpand = (id: string) => setExpandedKeys(current => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const totalSteps = picked.reduce((total, item) => total + item.steps.length, 0);
  const runPicked = () => onRun(picked);

  if (loading) return <div className="picker"><LoadingSpinner label="시나리오를 불러오는 중입니다." /></div>;
  if (!records.length) return (
    <div className="picker">
      <div className="picker-empty-state">
        <div className="picker-empty-title">저장된 시나리오가 없습니다.</div>
        <div className="picker-empty-body">편집기에서 시나리오를 작성하고 저장하면 팀과 함께 선택하고 실행할 수 있습니다.</div>
        <div className="picker-empty-actions"><Button variant="primary" onClick={onOpenEditor}>편집기 열기</Button></div>
      </div>
    </div>
  );

  return (
    <div className="picker">

      <div className="picker-layout">
        <ScenarioList
          records={records}
          activeId={activeRecord?.id ?? null}
          loading={loading}
          busy={false}
          pickedCountByRecord={pickedCountByRecord}
          onSelect={setActiveId}
          onNew={onOpenEditor}
          newLabel="편집기 열기"
        />

        <section className="picker-scenarios" data-ck-scroll="light">
          {activeRecord ? (
            <>
              <div className="picker-panel-heading">
                <Button
                  className="picker-scenario-main"
                  role="checkbox"
                  aria-label="전체 선택"
                  aria-checked={allActivePicked ? true : someActivePicked ? "mixed" : false}
                  disabled={!activeScenarios.length}
                  onClick={togglePickAll}
                >
                  <span className={`picker-check${someActivePicked ? " on" : ""}`} aria-hidden="true">
                    {someActivePicked && <span className="msi">{allActivePicked ? "check" : "remove"}</span>}
                  </span>
                  <div>
                    <p>{activeRecord.title}</p>
                    <strong>
                      {activeScenarios.length} scenario
                      {activeScenarios.length === 1 ? "" : "s"} ·{" "}
                      {activeScenarios.reduce((total, s) => total + s.steps.length, 0)} steps
                    </strong>
                  </div>
                </Button>
              </div>
              {activeScenarios.map((scenario) => {
                const key = scenario.id;
                const isPicked = pickedKeys.has(key);
                const isOpen = expandedKeys.has(key);
                const unlinked = scenario.steps.filter((step) => !step.connected).length;
                return (
                  <div className={`picker-scenario${isPicked ? " picked" : ""}`} key={key}>
                    <div className="picker-scenario-row">
                      <Button
                        className="picker-scenario-main"
                        aria-pressed={isPicked}
                        onClick={() => togglePick(scenario.id)}
                      >
                        <span className={`picker-check${isPicked ? " on" : ""}`}>
                          {isPicked && <span className="msi">check</span>}
                        </span>
                        <div>
                          <div className="picker-scenario-name">
                            <span>{scenario.title}</span>
                            {scenario.tag && <em className="picker-tag">{scenario.tag}</em>}
                          </div>
                          <div className="picker-scenario-summary">
                            {scenario.steps.length}개 단계
                            {unlinked ? ` · 선택자 미연결 ${unlinked}` : ""}
                          </div>
                        </div>
                      </Button>
                      <Button className="picker-expand" aria-expanded={isOpen} onClick={() => toggleExpand(key)}>
                        {isOpen ? "▾" : "▸"} 단계
                      </Button>
                      <Button
                        variant="secondary"
                        iconOnly
                        className="picker-run-only"
                        title="이 시나리오만 실행"
                        aria-label="이 시나리오만 실행"
                        onClick={() => onRun([scenario])}
                      >
                        <span className="msi">play_arrow</span>
                      </Button>
                    </div>
                    {isOpen && (
                      <ol className="picker-steps">
                        {scenario.steps.map((step, index) => (
                          <li key={step.id}>
                            <b>{String(index + 1).padStart(2, "0")}</b>
                            <ActionTag action={step.action} className="picker-op" />
                            <span className="picker-target">{actionText(step)}</span>
                            <em className={step.connected ? "" : "unlinked"}>
                              {step.connected ? "linked" : "unlinked"}
                            </em>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="picker-empty">저장된 시나리오를 선택해 주세요.</div>
          )}
        </section>

        <aside className="picker-cart">
          <div className="picker-col-label">
            <span>실행 대상</span>
            {picked.length > 0 && (
              <Button onClick={() => onPick(new Set())}>비우기</Button>
            )}
          </div>
          <div className="picker-cart-body" data-ck-scroll="light">
            {picked.length === 0 ? (
              <p className="picker-cart-empty">
                왼쪽 목록에서 실행할 시나리오를 선택하세요. 여러 문서에서 골라
                한 번에 실행할 수 있습니다.
              </p>
            ) : (
              pickedGroups.map((group) => (
                <div key={group.record.id}>
                  <div className="picker-cart-group">
                    <span>{group.record.title}</span>
                    <b>{group.scenarios.length}</b>
                  </div>
                  {group.scenarios.map((item, index) => (
                    <div className="picker-cart-item" key={item.id}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <span>{item.title}</span>
                      <i>{item.steps.length} steps</i>
                      <Button
                        variant="ghost"
                        iconOnly
                        title="선택 해제"
                        onClick={() => togglePick(item.id)}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
          <footer>
            <div className="picker-cart-stats">
              <div>
                <span>SCENARIOS</span>
                <strong>{picked.length}</strong>
              </div>
              <div>
                <span>STEPS</span>
                <strong>{totalSteps}</strong>
              </div>
            </div>
            <Button
              variant="primary"
              disabled={!picked.length}
              onClick={runPicked}
            >
              <span className="msi">play_arrow</span>
              {picked.length ? `${picked.length}개 시나리오 실행` : "시나리오를 선택하세요"}
            </Button>
          </footer>
        </aside>
      </div>
    </div>
  );
};
