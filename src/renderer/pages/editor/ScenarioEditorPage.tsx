import {
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  actionLabel,
  defaultMarkerPosition,
  markerColor,
  type Action,
  type Scenario,
  type Step,
} from "../../shared/model/scenario";

type Props = {
  mode: "text" | "marker";
  scenario: Scenario;
  sourceMarkdown: string;
  scenarioFilePath: string | null;
  previews: Scenario[];
  notice: string;
  selectedId: string;
  isAddingMarker: boolean;
  markersVisible: boolean;
  stepPanelCollapsed: boolean;
  stepPanelPosition: { top: number; left: number };
  stepPanelMoved: boolean;
  markerDialog: Step | null;
  pendingMarker: Step | null;
  webviewKey: number;
  onModeChange: (mode: "text" | "marker") => void;
  onImport: () => void;
  onExport: () => void;
  onSourceChange: (markdown: string) => void;
  onScenarioChange: (scenario: Scenario) => void;
  onRefresh: () => void;
  onBeginMarkerPlacement: () => void;
  onToggleMarkersVisible: () => void;
  onPlaceMarker: (event: MouseEvent<HTMLDivElement>) => void;
  onDeleteLast: () => void;
  onClearSteps: () => void;
  onReturnToText: () => void;
  onSelectStep: (id: string) => void;
  onEditStep: (step: Step) => void;
  onDeleteStep: (id: string) => void;
  onReorderSteps: (draggedId: string, targetId: string) => void;
  onStepPanelDrag: (event: PointerEvent<HTMLElement>) => void;
  onToggleStepPanel: (collapsed: boolean) => void;
  onUpdateMarkerDialog: (changes: Partial<Step>) => void;
  onCloseMarkerDialog: () => void;
  onCompleteMarkerDialog: () => void;
};

export const ScenarioEditorPage = ({
  mode,
  scenario,
  sourceMarkdown,
  scenarioFilePath,
  previews,
  notice,
  selectedId,
  isAddingMarker,
  markersVisible,
  stepPanelCollapsed,
  stepPanelPosition,
  stepPanelMoved,
  markerDialog,
  pendingMarker,
  webviewKey,
  onModeChange,
  onImport,
  onExport,
  onSourceChange,
  onScenarioChange,
  onRefresh,
  onBeginMarkerPlacement,
  onToggleMarkersVisible,
  onPlaceMarker,
  onDeleteLast,
  onClearSteps,
  onReturnToText,
  onSelectStep,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
  onStepPanelDrag,
  onToggleStepPanel,
  onUpdateMarkerDialog,
  onCloseMarkerDialog,
  onCompleteMarkerDialog,
}: Props) => {
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const stepDrag = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const clearStepDrag = () => {
    stepDrag.current = null;
    setDraggedStepId(null);
  };

  return (
    <>
    <div className="page-title editor-page-title">
      <div>
        <p className="eyebrow">SCENARIO WORKSPACE</p>
        <h1>시나리오 작성 / 편집</h1>
        <p>
          {mode === "text"
            ? "텍스트 기반 시나리오를 작성하고 실행 단계를 미리 확인하세요."
            : "대상 화면에서 마커를 선택해 액션과 순서를 편집하세요."}
        </p>
      </div>
      <div className="editor-mode-switch">
        <button
          className={mode === "text" ? "active" : ""}
          onClick={() => onModeChange("text")}
        >
          텍스트 편집
        </button>
        <button
          className={mode === "marker" ? "active" : ""}
          onClick={() => onModeChange("marker")}
        >
          화면에서 추출
        </button>
      </div>
    </div>
    {notice && <div className="notice">✓ {notice}</div>}
    {mode === "text" ? (
      <>
        <div className="editor-actions">
          <button className="button button-secondary" onClick={onImport}>
            시나리오 불러오기
          </button>
          <button className="button button-primary" onClick={onExport}>
            시나리오 저장하기
          </button>
          <span className="scenario-file-path" title={scenarioFilePath ?? undefined}>
            {scenarioFilePath ?? "저장된 파일 없음"}
          </span>
        </div>
        <div className="scenario-writing-grid">
          <section className="writing-card">
            <div className="writing-card-header">
              <strong>시나리오 Markdown</strong>
              <span>{previews[0]?.title ?? "미리보기"}.md</span>
            </div>
            <textarea
              className="scenario-source"
              value={sourceMarkdown}
              onChange={(event) => onSourceChange(event.target.value)}
              aria-label="시나리오 Markdown 원본"
            />
          </section>
          <aside className="scenario-preview">
            <div className="writing-card-header">
              <strong>실행 미리보기</strong>
              <span>
                {previews.length}개 시나리오 · {previews.reduce((total, item) => total + item.steps.length, 0)}개 단계 인식
              </span>
            </div>
            {previews.length > 0 ? (
              <>
                <div className="preview-scenario-list">
                  {previews.map((preview) => (
                    <article className="preview-scenario" key={preview.id}>
                      <div>
                        <h2>{preview.title}</h2>
                        <span className="tag">자동 인식</span>
                      </div>
                      <div className="preview-before">
                        <b>기본 URL</b>
                        <span>{preview.url}</span>
                      </div>
                      <ol>
                        {preview.steps.map((step) => (
                          <li key={step.id}>
                            <b>{actionLabel[step.action]}</b>
                            <span>{step.target}</span>
                          </li>
                        ))}
                      </ol>
                    </article>
                  ))}
                </div>
                <p className="preview-note">
                  Given / When / Then / And 문장을 자동으로 인식합니다. 불러온
                  시나리오는 화면 편집기에 반영됩니다.
                </p>
              </>
            ) : (
              <div className="preview-empty">
                <strong>시나리오 형식을 인식하지 못했습니다.</strong>
                <p>
                  <code># 시나리오: 제목</code>과{" "}
                  <code>Given /login 페이지로 이동</code> 형식으로 작성해
                  주세요.
                </p>
              </div>
            )}
          </aside>
        </div>
      </>
    ) : (
      <>
        <div className="marker-toolbar">
          <strong>{isAddingMarker ? "⌖ 위치 선택 중" : "✣ 핀 수정 중"}</strong>
          <button onClick={onBeginMarkerPlacement}>
            {isAddingMarker ? "다시 선택" : "마커 추가"}
          </button>
          <button
            onClick={onToggleMarkersVisible}
            aria-pressed={markersVisible}
          >
            {markersVisible ? "마커 숨기기" : "마커 보이기"}
          </button>
          <button onClick={onDeleteLast}>마지막 삭제</button>
          <button onClick={onClearSteps}>전체 초기화</button>
          <button className="button button-secondary" onClick={onReturnToText}>
            ×&nbsp; 편집기로 돌아가기
          </button>
        </div>
        <div className="marker-editor-layout">
          <section className="browser-canvas marker-canvas">
            <div className="browser-bar">
              <span className="browser-dots" aria-hidden="true">
                ● ● ●
              </span>
              <input
                value={scenario.url}
                onChange={(event) =>
                  onScenarioChange({ ...scenario, url: event.target.value })
                }
                aria-label="대상 URL"
              />
              <button className="browser-refresh" onClick={onRefresh}>
                ↻&nbsp; 새로고침
              </button>
            </div>
            <div className="mock-page">
              <webview
                className="target-frame"
                src={scenario.url}
                aria-label="시나리오 대상 페이지"
              />
              <div className="page-fallback">
                <div className="mock-logo">Electron 대상 페이지</div>
                <p>
                  데스크톱 웹뷰에서 대상 URL을 열었습니다. 연결 상태는
                  Playwright로 확인합니다.
                </p>
              </div>
              {isAddingMarker && (
                <div
                  className="marker-placement-layer"
                  onClick={onPlaceMarker}
                  aria-label="마커를 추가할 위치"
                />
              )}
              {markersVisible && scenario.steps.map((step, index) => {
                const position =
                  step.x === undefined || step.y === undefined
                    ? defaultMarkerPosition(index)
                    : { x: step.x, y: step.y };
                return (
                  step.connected && (
                    <button
                      key={step.id}
                      className={
                        "marker" + (selectedId === step.id ? " selected" : "")
                      }
                      style={{
                        left: `${position.x}%`,
                        top: `${position.y}%`,
                        backgroundColor: step.color ?? markerColor(index),
                      }}
                      onClick={() => onSelectStep(step.id)}
                      aria-label={`${step.id}번 ${step.target} 마커`}
                    >
                      {step.id}
                    </button>
                  )
                );
              })}
            </div>
          </section>
          {stepPanelCollapsed ? (
            <button
              className="step-panel-toggle collapsed"
              style={stepPanelPosition}
              onPointerDown={onStepPanelDrag}
              onClick={() => !stepPanelMoved && onToggleStepPanel(false)}
              aria-label="실행 단계 열기"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          ) : (
            <aside
              className="step-panel marker-steps"
              style={stepPanelPosition}
            >
              <div
                className="panel-heading step-panel-handle"
                onPointerDown={onStepPanelDrag}
              >
                <h2>실행 단계</h2>
                <span>{scenario.steps.length}개</span>
                <button
                  className="step-panel-toggle"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onToggleStepPanel(true)}
                  aria-label="실행 단계 접기"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m6 15 6-6 6 6" />
                  </svg>
                </button>
              </div>
              <ol className="step-list">
                {scenario.steps.map((step) => (
                  <li
                    key={step.id}
                    className={`${selectedId === step.id ? "selected" : ""}${draggedStepId === step.id ? " dragging" : ""}`}
                    data-step-id={step.id}
                  >
                    <button
                      type="button"
                      className="step-drag-handle"
                      aria-label={`${step.id}번 단계 순서 변경`}
                      onPointerDown={(event) => {
                        stepDrag.current = {
                          id: step.id,
                          pointerId: event.pointerId,
                          startX: event.clientX,
                          startY: event.clientY,
                          moved: false,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const drag = stepDrag.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        if (
                          !drag.moved &&
                          Math.hypot(
                            event.clientX - drag.startX,
                            event.clientY - drag.startY,
                          ) > 5
                        ) {
                          drag.moved = true;
                          setDraggedStepId(drag.id);
                        }
                      }}
                      onPointerUp={(event) => {
                        const drag = stepDrag.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                        if (drag.moved) {
                          const target = document
                            .elementFromPoint(event.clientX, event.clientY)
                            ?.closest<HTMLLIElement>("[data-step-id]");
                          const targetId = target?.dataset.stepId;
                          if (targetId) onReorderSteps(drag.id, targetId);
                          event.preventDefault();
                        }
                        clearStepDrag();
                      }}
                      onPointerCancel={clearStepDrag}
                    >
                      ⠿
                    </button>
                    <button
                      className="step-select-button"
                      onClick={() => onSelectStep(step.id)}
                    >
                      <b>{step.id}</b>
                      <span>
                        <strong>{actionLabel[step.action]}</strong>
                        {step.target}
                        <small>
                          {step.connected ? "연결됨" : "미연결 단계"}
                        </small>
                      </span>
                    </button>
                    <button
                      className="edit-step-button"
                      onClick={() => onEditStep(step)}
                      aria-label="단계 편집"
                    >
                      ✎
                    </button>
                    <button
                      className="delete-button"
                      onClick={() => onDeleteStep(step.id)}
                      aria-label="단계 삭제"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
              <button className="add-step" onClick={onBeginMarkerPlacement}>
                + 새 마커 추가
              </button>
            </aside>
          )}
        </div>
      </>
    )}
    {markerDialog && (
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="marker-action-title"
      >
        <div className="manual-modal marker-action-modal">
          <p className="eyebrow">
            {pendingMarker ? "NEW MARKER" : "EDIT MARKER"} · STEP{" "}
            {markerDialog.id}
          </p>
          <h2 id="marker-action-title">마커 액션 정의</h2>
          <p>선택한 위치에서 실행할 액션을 설정해 주세요.</p>
          <label>
            액션
            <select
              value={markerDialog.action}
              onChange={(event) =>
                onUpdateMarkerDialog({ action: event.target.value as Action })
              }
            >
              {Object.entries(actionLabel).map(([value, name]) => (
                <option value={value} key={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            라벨
            <input
              autoFocus
              value={markerDialog.target}
              onChange={(event) =>
                onUpdateMarkerDialog({ target: event.target.value })
              }
              placeholder="예: 로그인 버튼"
            />
          </label>
          {["fill", "manualFill"].includes(markerDialog.action) && (
            <div className="input-target-alert" role="alert">
              <strong>입력 대상 확인</strong>
              <span>
                라벨은 페이지의 label, placeholder 또는 name과 일치해야 합니다.
                다르면 입력 단계가 실패할 수 있습니다.
              </span>
            </div>
          )}
          {markerDialog.action === "expectText" && (
            <div className="input-target-alert" role="alert">
              <strong>확인할 결과 텍스트 입력</strong>
              <span>
                라벨에 실행 후 화면에 표시되어야 하는 텍스트를 입력해 주세요.
                해당 텍스트를 찾지 못하면 결과 확인 단계가 실패합니다.
              </span>
            </div>
          )}
          {markerDialog.action === "click" && (
            <label>
              동일 대상 순서
              <input
                type="number"
                min="1"
                value={markerDialog.occurrence ?? 1}
                onChange={(event) => {
                  const occurrence = Math.max(
                    1,
                    Number(event.target.value) || 1,
                  );
                  onUpdateMarkerDialog({
                    occurrence: occurrence === 1 ? undefined : occurrence,
                  });
                }}
              />
              <small>
                같은 이름의 버튼이 여러 개면 클릭할 순서를 지정합니다.
              </small>
            </label>
          )}
          {["fill", "select"].includes(markerDialog.action) && (
            <label>
              값
              <input
                value={markerDialog.value ?? ""}
                onChange={(event) =>
                  onUpdateMarkerDialog({ value: event.target.value })
                }
                placeholder="입력 또는 선택할 값"
              />
            </label>
          )}
          {markerDialog.action === "manualFill" && (
            <label>
              안내 문구
              <input
                value={markerDialog.prompt ?? ""}
                onChange={(event) =>
                  onUpdateMarkerDialog({
                    prompt: event.target.value,
                    required: true,
                  })
                }
                placeholder="사용자에게 표시할 안내"
              />
            </label>
          )}
          <div className="modal-actions">
            <button
              className="button button-secondary"
              onClick={onCloseMarkerDialog}
            >
              취소
            </button>
            <button
              className="button button-primary"
              onClick={onCompleteMarkerDialog}
              disabled={!markerDialog.target.trim()}
            >
              마커 편집 완료
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};
