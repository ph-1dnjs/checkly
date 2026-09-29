import type { Scenario } from "../../../../../app/api-testing/shared/scenario";
import type { ApiOperation } from "../../../../../app/api-testing/shared/workspace";
import { Icon } from "../../../../shared/ui/Icon";
import { moveStep } from "../model/scenario-builder-model";
import { SortableList } from "../../../../shared/ui/SortableList";

type Step = Scenario["steps"][number];

export function SelectedApiList({ scenario, disabled, onChange, onLocate, getLabel = step => step.name ?? step.id, getOperation }: { scenario: Scenario; disabled: boolean; onChange: (next: Scenario) => void; onLocate: (step: Step) => void; getLabel?: (step: Step) => string; getOperation?: (step: Step) => Pick<ApiOperation, "method" | "path"> | undefined }) {
  const describe = (step: Step) => {
    const operation = getOperation?.(step);
    return {
      method: operation?.method ?? ("method" in step.api ? step.api.method : "API"),
      path: operation?.path ?? ("path" in step.api ? step.api.path : step.api.operationId),
    };
  };
  return <SortableList items={scenario.steps} disabled={disabled} className="api-selected-rows"
    itemKey={step => step.id}
    itemLabel={(step, index) => `${index + 1}단계 ${describe(step).path}`}
    itemClassName={step => `api-selected-row api-selected-${describe(step).method.toLowerCase()}`}
    onMove={(from, to) => onChange(moveStep(scenario, from, to - from))}
    renderItem={(step, index, position) => {
      const { method, path } = describe(step);
      return <>
        <span className="api-selected-number">{position + 1}</span>
        <span className="api-selected-method">{method}</span>
        <button type="button" className="api-selected-content" title="API 문서에서 위치 보기" aria-label={`${index + 1}단계 ${path} 문서로 이동`} onClick={() => onLocate(step)}>
          <code className="api-selected-path">{path}</code>
          <span className="api-selected-description">{getLabel(step)}</span>
        </button>
        <button type="button" className="api-selected-remove" disabled={disabled} title="단계 제거" aria-label={`${index + 1}단계 제거`} onClick={() => onChange({ ...scenario, steps: scenario.steps.filter(s => s.id !== step.id) })}><Icon name="close" size={16} /></button>
      </>;
    }} />;
}
