import { useState } from "react";
import type { Scenario } from "../../shared/model/scenario";
import { editableValueDefault, EDITABLE_VALUE_KIND } from "../../shared/model/scenario-duplication";
import { ActionTag } from "../../shared/ui/ActionTag";
import "./duplicate-scenario.css";

type Props = {
  scenario: Scenario;
  onDuplicate: (scenarioId: string, name: string, cases: Array<Record<string, string>>) => void;
  onClose: () => void;
};

export const DuplicateScenarioModal = ({ scenario, onDuplicate, onClose }: Props) => {
  const [dupName, setDupName] = useState(`${scenario.title} 복제`);
  const [dupCases, setDupCases] = useState<Array<Record<string, string>>>([{}]);
  const [dupCaseIndex, setDupCaseIndex] = useState(0);

  const addDupCase = () => {
    setDupCaseIndex(dupCases.length);
    setDupCases((cases) => [...cases, {}]);
  };
  const removeDupCase = () => {
    if (dupCases.length < 2) return;
    setDupCases((cases) => cases.filter((_, index) => index !== dupCaseIndex));
    setDupCaseIndex((index) => Math.max(0, index - 1));
  };
  const setDupValue = (stepId: string, value: string) =>
    setDupCases((cases) =>
      cases.map((item, index) =>
        index === dupCaseIndex ? { ...item, [stepId]: value } : item,
      ),
    );
  const submitDuplicate = () => {
    onDuplicate(scenario.id, dupName, dupCases);
    onClose();
  };
  return (
    <div
      className="modal-backdrop duplicate-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-scenario-title"
      onClick={onClose}
    >
      <div
        className="manual-modal duplicate-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="duplicate-modal-header">
          <div className="duplicate-modal-icon" aria-hidden="true">⧉</div>
          <div>
            <h2 id="duplicate-scenario-title">템플릿으로 복제</h2>
            <p className="duplicate-description">값만 바꿔 여러 시나리오를 한 번에 만들 수 있어요.</p>
          </div>
        </div>

        <div className="duplicate-source">
          <span className="duplicate-source-label">원본 시나리오</span>
          <strong>{scenario.title}</strong>
          <span>{scenario.steps.length}개 단계</span>
        </div>

        <label className="duplicate-name-field">
          복제본 이름
          <input
            value={dupName}
            onChange={(event) => setDupName(event.target.value)}
            placeholder="예: 로그인 복제"
          />
        </label>

        <section className="duplicate-editor" aria-label="복제 케이스 값 편집">
          <div className="duplicate-editor-heading">
            <div>
              <span>케이스별 값</span>
              <p>비워두면 원본 값을 그대로 사용합니다.</p>
            </div>
            <button
              type="button"
              className="duplicate-add-case"
              title="케이스를 추가해 한 번에 여러 개를 복제합니다"
              onClick={addDupCase}
            >
              + 케이스 추가
            </button>
          </div>

          <div className="duplicate-case-tabs" role="tablist" aria-label="복제 케이스 선택">
            {dupCases.map((_, index) => (
              <button
                type="button"
                role="tab"
                aria-selected={index === dupCaseIndex}
                key={index}
                className={index === dupCaseIndex ? "active" : ""}
                onClick={() => setDupCaseIndex(index)}
              >
                케이스 {index + 1}
              </button>
            ))}
            {dupCases.length > 1 && (
              <button
                type="button"
                className="duplicate-remove-case"
                onClick={removeDupCase}
              >
                현재 케이스 삭제
              </button>
            )}
          </div>

          <div className="duplicate-rows">
            {scenario.steps.map((step) => {
              const kind = EDITABLE_VALUE_KIND[step.action];
              if (!kind) return null;
              const value = dupCases[dupCaseIndex]?.[step.id] ?? "";
              return (
                <div className="duplicate-row" key={step.id}>
                  <ActionTag action={step.action} />
                  <span title={step.target}>{step.target}</span>
                  <em>{kind === "in" ? "입력" : "확인"}</em>
                  <input
                    value={value}
                    placeholder={editableValueDefault(step, kind)}
                    onChange={(event) => setDupValue(step.id, event.target.value)}
                    aria-label={`${step.target} 값`}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <div className="modal-actions duplicate-actions">
          <p className="duplicate-summary">총 <strong>{dupCases.length}개</strong> 시나리오가 생성됩니다</p>
          <button className="button button-secondary" onClick={onClose}>
            취소
          </button>
          <button className="button button-primary" onClick={submitDuplicate}>
            {dupCases.length > 1 ? `${dupCases.length}개 복제` : "복제"}
          </button>
        </div>
      </div>
    </div>
  );
};
