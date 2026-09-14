import { useRef, useState } from "react";
import type { Scenario } from "../../../app/api-testing/shared/scenario";
import { moveStep } from "./scenario-builder-model";

export function SelectedApiList({ scenario, disabled, onChange, onLocate, getLabel = step => step.name ?? step.id }: { scenario: Scenario; disabled: boolean; onChange: (next: Scenario) => void; onLocate: (step: Scenario["steps"][number]) => void; getLabel?: (step: Scenario["steps"][number]) => string }) {
  const dragging = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const move = (id: string, target: string) => {
    const from = scenario.steps.findIndex(s => s.id === id), to = scenario.steps.findIndex(s => s.id === target);
    if (disabled || from < 0 || to < 0 || from === to) return;
    onChange(moveStep(scenario, from, to - from));
    setAnnouncement(`${from + 1}번 API를 ${to + 1}번으로 이동했습니다.`);
  };
  return <><ol className="api-selected-rows">{scenario.steps.map((step, index) => {
    const method = "method" in step.api ? step.api.method : "API";
    const path = "path" in step.api ? step.api.path : step.api.operationId;
    return <li key={step.id} className={`api-selected-row api-selected-${method.toLowerCase()}`} data-drop={over === step.id || undefined}
      onDragOver={event => { if (!disabled && dragging.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(step.id); } }}
      onDrop={event => { if (dragging.current) { event.preventDefault(); move(dragging.current, step.id); } dragging.current = null; setOver(null); }}>
      <button type="button" className="api-selected-handle" disabled={disabled} draggable={!disabled} aria-label={`${index + 1}단계 순서 변경`} title="드래그 또는 위·아래 방향키로 순서 변경"
        onDragStart={event => { dragging.current = step.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", step.id); }}
        onDragEnd={() => { dragging.current = null; setOver(null); }}
        onKeyDown={event => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const target = scenario.steps[index + (event.key === "ArrowUp" ? -1 : 1)]; if (target) move(step.id, target.id); }}><span className="msi" aria-hidden="true">drag_indicator</span></button>
      <span className="api-selected-number">{index + 1}</span>
      <span className="api-selected-method">{method}</span>
      <div className="api-selected-content">
        <code className="api-selected-path">{path}</code>
        <span className="api-selected-description">{getLabel(step)}</span>
      </div>
      <button type="button" className="api-selected-locate" disabled={disabled} title="Swagger에서 위치 보기" aria-label={`${index + 1}단계 API 문서로 이동`} onClick={() => onLocate(step)}><span className="msi" aria-hidden="true">link</span></button>
      <button type="button" className="api-selected-remove" disabled={disabled} title="선택 취소" aria-label={`${index + 1}단계 선택 취소`} onClick={() => onChange({ ...scenario, steps: scenario.steps.filter(s => s.id !== step.id) })}><span className="msi" aria-hidden="true">close</span></button>
    </li>;
  })}</ol><span role="status" className="api-selected-announcement">{announcement}</span></>;
}
