import { useMemo, useState } from "react";
import { actionText, parseMarkdown, type MarkerPositionStore, type Scenario } from "../../shared/model/scenario";
import type { WebScenarioRecord } from "../../../app/ipc/web-scenario/types";
import { ActionTag } from "../../shared/ui/ActionTag";
import { Button } from "../../shared/ui/Button";
import { LoadingSpinner } from "../../shared/ui/LoadingSpinner";
import { SortableList } from "../../shared/ui/SortableList";
import { ScenarioList } from "../../widgets/ScenarioList";

type Props = {
  records: WebScenarioRecord[];
  loading: boolean;
  pickedKeys: Set<string>;
  onPick: (keys: Set<string>) => void;
  onOpenEditor: () => void;
  onRefresh: () => void;
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
type ScenarioGroup = { record: WebScenarioRecord; scenarios: Scenario[] };
/** Picked scenarios grouped by file. Files and scenarios keep the order of `pickedKeys` (pick order). */
export const pickedScenarioGroups = (groups: ScenarioGroup[], pickedKeys: Set<string>): ScenarioGroup[] => {
  const owners = new Map(groups.flatMap(group => group.scenarios.map(scenario => [scenario.id, { group, scenario }] as const)));
  const picked = new Map<string, ScenarioGroup>();
  for (const key of pickedKeys) {
    const owner = owners.get(key);
    if (!owner) continue;
    const entry = picked.get(owner.group.record.id) ?? { record: owner.group.record, scenarios: [] };
    entry.scenarios.push(owner.scenario);
    picked.set(owner.group.record.id, entry);
  }
  return [...picked.values()];
};
export const ScenarioPickerPage = ({ records, loading, pickedKeys, onPick, onOpenEditor, onRefresh, onRun }: Props) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const groups = useMemo(() => records.map(record => ({ record, scenarios: recordScenarios(record) })), [records]);
  const activeGroup = groups.find(group => group.record.id === activeId) ?? groups[0];
  const activeRecord = activeGroup?.record;
  const activeScenarios = activeGroup?.scenarios ?? [];
  const pickedGroups = pickedScenarioGroups(groups, pickedKeys);
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
  const moveGroup = (from: number, to: number) => {
    const next = [...pickedGroups];
    next.splice(to, 0, ...next.splice(from, 1));
    // Keys of scenarios no longer in the list stay at the end.
    onPick(new Set([...next.flatMap(group => group.scenarios.map(scenario => scenario.id)), ...pickedKeys]));
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

  const tagCounts = activeScenarios.reduce<Record<string, number>>((counts, scenario) => {
    if (scenario.tag) counts[scenario.tag] = (counts[scenario.tag] ?? 0) + 1;
    return counts;
  }, {});

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
          onRefresh={onRefresh}
        />

        <section className="picker-scenarios">
          {activeRecord ? (
            <>
              <div className="picker-panel-heading">
                <Button
                  className="picker-scenario-main"
                  role="checkbox"
                  aria-label="전체 선택"
                  title="문서 전체 선택"
                  aria-checked={allActivePicked ? true : someActivePicked ? "mixed" : false}
                  disabled={!activeScenarios.length}
                  onClick={togglePickAll}
                >
                  <span className={`picker-check${someActivePicked ? " on" : ""}`} aria-hidden="true">
                    {someActivePicked && <span className="msi">{allActivePicked ? "check" : "remove"}</span>}
                  </span>
                  <div>
                    <p title={activeRecord.title}>{activeRecord.title}</p>
                    <strong>
                      {activeScenarios.length} scenario
                      {activeScenarios.length === 1 ? "" : "s"} ·{" "}
                      {activeScenarios.reduce((total, s) => total + s.steps.length, 0)} steps
                    </strong>
                  </div>
                </Button>
                {Object.keys(tagCounts).length > 0 && (
                  <div className="picker-tags">
                    <span>태그</span>
                    {Object.entries(tagCounts).map(([tag, count]) => (
                      <em key={tag} className="picker-tag">{tag}<b>{count}</b></em>
                    ))}
                  </div>
                )}
              </div>
              <div className="picker-scenario-list" data-ck-scroll="light">
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
                        <span className={`picker-check${isPicked ? " on" : ""}`} aria-hidden="true">
                          {isPicked && <span className="msi">check</span>}
                        </span>
                        <div>
                          <div className="picker-scenario-name" title={scenario.title}>{scenario.title}</div>
                          <div className="picker-scenario-summary">
                            <span>{scenario.steps.length}단계</span>
                            {unlinked > 0 && <span className="unlinked">선택자 미연결 {unlinked}</span>}
                          </div>
                        </div>
                      </Button>
                      <Button
                        className="picker-expand"
                        aria-expanded={isOpen}
                        aria-label="단계 보기"
                        title="단계 보기"
                        onClick={() => toggleExpand(key)}
                      >
                        <span className="msi" aria-hidden="true">{isOpen ? "expand_less" : "expand_more"}</span>
                      </Button>
                      <Button
                        className="picker-run-only"
                        title="이 시나리오만 실행"
                        aria-label="이 시나리오만 실행"
                        onClick={() => onRun([scenario])}
                      >
                        <span className="msi" aria-hidden="true">play_arrow</span>
                      </Button>
                    </div>
                    {isOpen && (
                      <ol className="picker-steps">
                        {scenario.steps.map((step, index) => (
                          <li key={step.id}>
                            <b>{index + 1}</b>
                            <ActionTag action={step.action} className="picker-op" />
                            <span className="picker-target" title={actionText(step)}>{actionText(step)}</span>
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
              </div>
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
                선택한 시나리오가 여기에 모입니다. 여러 문서에서 골라 한 번에 실행할 수 있습니다.
              </p>
            ) : (
              <SortableList
                items={pickedGroups}
                className="picker-cart-files"
                itemKey={(group) => group.record.id}
                itemLabel={(group, index) => `${index + 1}번째 파일 ${group.record.title}`}
                itemClassName={() => "picker-cart-file"}
                onMove={moveGroup}
                renderItem={(group) => (
                  <>
                    <div className="picker-cart-group">
                      <span title={group.record.title}>{group.record.title}</span>
                      <b>{group.scenarios.length}개</b>
                    </div>
                    {group.scenarios.map((item) => (
                      <div className="picker-cart-item" key={item.id}>
                        <b>{String(picked.indexOf(item) + 1).padStart(2, "0")}</b>
                        <span title={item.title}>{item.title}</span>
                        <i>{item.steps.length}</i>
                        <Button
                          className="picker-cart-remove"
                          title="빼기"
                          aria-label={`${item.title} 빼기`}
                          onClick={() => togglePick(item.id)}
                        >
                          <span className="msi" aria-hidden="true">close</span>
                        </Button>
                      </div>
                    ))}
                  </>
                )}
              />
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
              <span className="msi" aria-hidden="true">play_arrow</span>
              {picked.length ? `${picked.length}개 시나리오 실행` : "시나리오를 선택하세요"}
            </Button>
          </footer>
        </aside>
      </div>
    </div>
  );
};
