import { useState } from "react";
import { actionText, parseMarkdown, type MarkerPositionStore, type Scenario } from "../../shared/model/scenario";
import type { WebScenarioRecord } from "../../../app/ipc/web-scenario/types";
import { Button } from "../../shared/ui/Button";

type Props = {
  records: WebScenarioRecord[];
  pickedKeys: Set<string>;
  onPick: (keys: Set<string>) => void;
  onOpenEditor: () => void;
  onRun: (scenarios: Scenario[]) => void;
};
export const recordScenarios = (record: WebScenarioRecord): Scenario[] => {
  const positions = JSON.parse(record.positions) as MarkerPositionStore;
  return parseMarkdown(record.markdown, record.id).map(scenario => ({ ...scenario,
    steps: scenario.steps.map(step => ({ ...step, ...positions[`${scenario.title}\n${scenario.url}`]?.find(item =>
      item.action === step.action && item.target === step.target && item.value === step.value &&
      item.prompt === step.prompt && item.condition === step.condition && item.waitSeconds === step.waitSeconds),
    })),
  }));
};
export const ScenarioPickerPage = ({ records, pickedKeys, onPick, onOpenEditor, onRun }: Props) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scenarios = records.flatMap(recordScenarios);
  const picked = scenarios.filter(scenario => pickedKeys.has(scenario.id));
  const toggle = (id: string) => {
    const next = new Set(pickedKeys);
    next.has(id) ? next.delete(id) : next.add(id);
    onPick(next);
  };
  return (
    <div className="picker">
      <div className="picker-layout">
        <section className="picker-scenarios">
          <div className="picker-panel-heading">
            <strong>저장된 시나리오 {scenarios.length}개</strong>
            <Button onClick={() => onPick(picked.length === scenarios.length ? new Set() : new Set(scenarios.map(item => item.id)))}>전체 선택 / 해제</Button>
          </div>
          {!scenarios.length && <div className="picker-empty-state"><p>저장된 시나리오가 없습니다.</p><Button onClick={onOpenEditor}>편집기 열기</Button></div>}
          {scenarios.map(scenario => (
            <div className={`picker-scenario${pickedKeys.has(scenario.id) ? " picked" : ""}`} key={scenario.id}>
              <div className="picker-scenario-row">
                <Button className="picker-scenario-main" aria-pressed={pickedKeys.has(scenario.id)} onClick={() => toggle(scenario.id)}>
                  <span className={`picker-check${pickedKeys.has(scenario.id) ? " on" : ""}`}>{pickedKeys.has(scenario.id) ? "✓" : ""}</span>
                  <div><div className="picker-scenario-name">{scenario.title}</div><small>{scenario.steps.length}개 단계</small></div>
                </Button>
                <Button onClick={() => setExpanded(current => { const next = new Set(current); next.has(scenario.id) ? next.delete(scenario.id) : next.add(scenario.id); return next; })}>단계</Button>
                <Button title="이 시나리오만 실행" onClick={() => onRun([scenario])}>실행</Button>
              </div>
              {expanded.has(scenario.id) && <ol className="picker-steps">{scenario.steps.map(step => <li key={step.id}>{actionText(step)}</li>)}</ol>}
            </div>
          ))}
        </section>
        <aside className="picker-cart">
          <div className="picker-col-label"><span>실행 대상</span><Button onClick={() => onPick(new Set())}>비우기</Button></div>
          <div className="picker-cart-body">{picked.map(item => <div className="picker-cart-item" key={item.id}><span>{item.title}</span><Button onClick={() => toggle(item.id)}>선택 해제</Button></div>)}</div>
          <footer><Button variant="primary" disabled={!picked.length} onClick={() => onRun(picked)}>{picked.length}개 시나리오 실행</Button></footer>
        </aside>
      </div>
    </div>
  );
};
