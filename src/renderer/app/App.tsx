import type { CSSProperties, ReactElement } from "react";
import { DashboardPage } from "../pages/dashboard/DashboardPage";
import { ScenarioEditorPage } from "../pages/editor/ScenarioEditorPage";
import { RunPage } from "../pages/run/RunPage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import { ScenarioPickerPage } from "../pages/picker/ScenarioPickerPage";
import { BottomNavigation } from "../widgets/BottomNavigation";
import { RunReportDrawer } from "../widgets/RunReportDrawer";
import "../shared/model/electron-api";
import { useNavigation } from "./hooks/useNavigation";
import { useScenarioState } from "./hooks/useScenarioState";
import { useRunOrchestration } from "./hooks/useRunOrchestration";

export const App = (): ReactElement => {
  const { route, setRoute, toast, showToast } = useNavigation();
  const scenarioState = useScenarioState({ route, showToast });
  const runOrchestration = useRunOrchestration({ showToast, setRoute });

  const {
    scenario,
    sourceMarkdown,
    isDirty,
    scenarioFilePath,
    markerScenarioId,
    editorMode,
    setEditorMode,
    selectedId,
    isAddingMarker,
    markersVisible,
    saveBeforeReturning,
    setSaveBeforeReturning,
    previews,
    executableScenario,
    executableScenarios,
    markerDialog,
    pendingMarker,
    updateSteps,
    updateSource,
    importScenario,
    saveScenarioFile,
    commitEditorRunSnapshot,
    placeMarker,
    updateMarker,
    closeMarkerDialog,
    completeMarker,
    saveMarkerEditsAndReturn,
    selectMarkerScenario,
    reorderSteps,
    setScenario,
    setSelectedId,
    setEditingMarker,
    setIsAddingMarker,
    setMarkersVisible,
  } = scenarioState;

  const {
    manual,
    manualControl,
    manualValue,
    manualValueVisible,
    setManualValue,
    setManualValueVisible,
    manualResult,
    manualFailureReason,
    setManualFailureReason,
    running,
    runningScenario,
    runLog,
    runProgress,
    runStartedAt,
    elapsedSeconds,
    livePreview,
    setLivePreview,
    previewImage,
    stepPreviews,
    runVideos,
    fullRunVideoPath,
    runNotification,
    setRunNotification,
    runHistory,
    runSummary,
    liveResults,
    openRunRecord,
    setOpenRunRecord,
    runQueue,
    runValidationError,
    setRunValidationError,
    runProgressPercent,
    scenarioProgressPercent,
    beginRuns,
    cancelRuns,
    popoutViewport,
    submitManualInput,
    cancelManual,
    completeManualControl,
    failManualControl,
    passManualResult,
    failManualResult,
    downloadRunVideo,
    downloadFullRunVideo,
  } = runOrchestration;

  const runEditorContent = () => beginRuns(commitEditorRunSnapshot(), true);

  return (
    <main
      className={`workspace${route === "editor" && editorMode === "marker" ? " screen-extract-workspace" : ""}${route === "run" ? " run-workspace" : ""}`}
    >
      <section className="content">
        {route === "dashboard" && (
          <DashboardPage
            history={runHistory}
            summary={runSummary}
            onOpenRun={() => setRoute("run")}
            onOpenPicker={() => setRoute("picker")}
            onOpenReport={setOpenRunRecord}
          />
        )}
        {route === "editor" && (
          <ScenarioEditorPage
            mode={editorMode}
            scenario={scenario}
            sourceMarkdown={sourceMarkdown}
            isDirty={isDirty}
            scenarioFilePath={scenarioFilePath}
            previews={previews}
            markerScenarioId={markerScenarioId || previews[0]?.id || ""}
            selectedId={selectedId}
            isAddingMarker={isAddingMarker}
            markersVisible={markersVisible}
            markerDialog={markerDialog}
            pendingMarker={pendingMarker}
            onModeChange={setEditorMode}
            onSelectMarkerScenario={selectMarkerScenario}
            onImport={() => void importScenario()}
            onExport={() => void saveScenarioFile()}
            onSelectUploadFile={() => window.electronAPI.selectUploadFile()}
            onRun={runEditorContent}
            onSourceChange={updateSource}
            onScenarioChange={setScenario}
            onBeginMarkerPlacement={() => setIsAddingMarker(true)}
            onToggleMarkersVisible={() =>
              setMarkersVisible((visible) => !visible)
            }
            onPlaceMarker={placeMarker}
            onDeleteLast={() => updateSteps(scenario.steps.slice(0, -1))}
            onClearSteps={() => updateSteps([])}
            onReturnToText={() => setSaveBeforeReturning(true)}
            onSelectStep={setSelectedId}
            onEditStep={setEditingMarker}
            onDeleteStep={(id) =>
              updateSteps(scenario.steps.filter((step) => step.id !== id))
            }
            onReorderSteps={reorderSteps}
            onUpdateMarkerDialog={updateMarker}
            onCloseMarkerDialog={closeMarkerDialog}
            onCompleteMarkerDialog={completeMarker}
          />
        )}
        {route === "picker" && (
          <ScenarioPickerPage
            onOpenEditor={() => setRoute("editor")}
            onRun={(items) => beginRuns(items)}
          />
        )}
        {route === "run" && (
          <RunPage
            scenario={running ? runningScenario : executableScenario}
            scenarios={runQueue.length ? runQueue : executableScenarios}
            scenarioResults={liveResults}
            running={running}
            manual={manual}
            manualValue={manualValue}
            manualValueVisible={manualValueVisible}
            onManualValueChange={setManualValue}
            onToggleManualValueVisible={() =>
              setManualValueVisible((visible) => !visible)
            }
            onSubmitManualInput={submitManualInput}
            onCancelManual={cancelManual}
            manualControl={manualControl}
            manualResult={manualResult}
            runLog={runLog}
            runProgress={runProgress}
            elapsedSeconds={elapsedSeconds}
            runStartedAt={runStartedAt}
            livePreview={livePreview}
            previewImage={previewImage}
            stepPreviews={stepPreviews}
            onManualBrowserEvent={(event) =>
              void window.electronAPI.controlManualBrowser(event)
            }
            onSetViewport={(width, height) =>
              void window.electronAPI.setQaViewport({ width, height })
            }
            onCompleteManualControl={completeManualControl}
            onFailManualControl={failManualControl}
            onGoToPicker={() => setRoute("picker")}
            onCancel={cancelRuns}
            onPopout={popoutViewport}
            onLivePreviewChange={setLivePreview}
            runVideos={runVideos}
            fullRunVideoAvailable={Boolean(fullRunVideoPath)}
            onDownloadRunVideo={downloadRunVideo}
            onDownloadFullRunVideo={downloadFullRunVideo}
          />
        )}
        {route === "settings" && <SettingsPage scenario={scenario} />}
      </section>
      <RunReportDrawer
        record={openRunRecord}
        onClose={() => setOpenRunRecord(null)}
        onRerun={(scenarios) => {
          setOpenRunRecord(null);
          beginRuns(scenarios);
        }}
      />
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span
            className="toast-dot"
            style={{ background: toast.includes("못") ? "#B32318" : "#1E7A4A" }}
          />
          {toast}
        </div>
      )}
      {runNotification && route !== "run" && (
        <section
          className={`run-notification ${runNotification.status}`}
          role="status"
          aria-live="polite"
          aria-label="시나리오 실행 알림"
        >
          <button
            className="run-notification-close"
            onClick={() => setRunNotification(null)}
            aria-label="실행 알림 닫기"
          >
            ×
          </button>
          {runNotification.status === "running" ? (
            <>
              <div
                className="run-notification-scenario-progress"
                style={
                  {
                    "--scenario-progress": `${scenarioProgressPercent}%`,
                  } as CSSProperties
                }
                aria-label={`시나리오 묶음 진행률 ${scenarioProgressPercent}%`}
              >
                <div
                  className="run-notification-progress"
                  style={
                    { "--progress": `${runProgressPercent}%` } as CSSProperties
                  }
                  aria-label={`현재 시나리오 단계 진행률 ${runProgressPercent}%`}
                >
                  <span>{runProgressPercent}%</span>
                </div>
              </div>
              <div className="run-notification-copy">
                <strong>시나리오 실행 중</strong>
                <span>
                  {runNotification.currentScenario}/{runNotification.total}개 ·{" "}
                  {runNotification.scenarioTitle}
                </span>
                <small>
                  현재 단계 {runProgress.step || "시작 준비"} · {elapsedSeconds}
                  초 경과
                </small>
              </div>
            </>
          ) : (
            <>
              <div className="run-notification-result">
                {runNotification.status === "passed"
                  ? "✓"
                  : runNotification.status === "failed"
                    ? "!"
                    : "—"}
              </div>
              <div className="run-notification-copy">
                <strong>
                  {runNotification.status === "passed"
                    ? "시나리오 실행 성공"
                    : runNotification.status === "failed"
                      ? "시나리오 실행 실패"
                      : "시나리오 실행 취소"}
                </strong>
                <div className="run-notification-summary">
                  <span>{runNotification.total}개 실행</span>
                  <i aria-hidden="true">·</i>
                  <b className="passed">성공 {runNotification.passed}</b>
                  <b className="failed">실패 {runNotification.failed}</b>
                </div>
              </div>
            </>
          )}
          <button
            className="button button-secondary run-notification-link"
            onClick={() => setRoute("run")}
          >
            바로가기 <span aria-hidden="true">→</span>
          </button>
        </section>
      )}
      <BottomNavigation
        route={route}
        running={running}
        onNavigate={setRoute}
        onRun={() =>
          beginRuns(route === "run" ? runQueue : executableScenarios)
        }
        onCancel={cancelRuns}
      />
      {runValidationError && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-validation-title"
        >
          <div className="manual-modal">
            <h2 id="run-validation-title">시나리오를 실행할 수 없습니다</h2>
            <p>{runValidationError}</p>
            <div className="modal-actions">
              <button
                className="button button-primary"
                onClick={() => setRunValidationError(null)}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      {saveBeforeReturning && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-scenario-title"
        >
          <div className="manual-modal">
            <h2 id="save-scenario-title">시나리오를 저장할까요?</h2>
            <p>화면에서 수정한 실행 단계를 Markdown 시나리오에 반영합니다.</p>
            <div className="modal-actions">
              <button onClick={() => setSaveBeforeReturning(false)}>
                취소
              </button>
              <button
                onClick={() => {
                  setSaveBeforeReturning(false);
                  setEditorMode("text");
                }}
              >
                저장하지 않고 돌아가기
              </button>
              <button
                className="button button-primary"
                onClick={() => void saveMarkerEditsAndReturn()}
              >
                저장 후 돌아가기
              </button>
            </div>
          </div>
        </div>
      )}
      {manualResult && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-result-title"
        >
          <div className="manual-modal">
            <h2 id="manual-result-title">수동 결과 확인이 필요합니다</h2>
            <p>
              {manualResult.prompt ||
                `${manualResult.target} 진행 후 결과를 선택해 주세요.`}
            </p>
            <p className="security-note">
              최대 5분 동안 대기합니다. 실패를 선택하면 사유가 실행 로그와
              보고서에 기록됩니다.
            </p>
            <label>
              실패 사유
              <input
                autoFocus
                value={manualFailureReason}
                onChange={(event) => setManualFailureReason(event.target.value)}
                placeholder="실패 시 사유를 입력하세요"
              />
            </label>
            <div className="modal-actions">
              <button
                className="button danger"
                disabled={!manualFailureReason.trim()}
                onClick={failManualResult}
              >
                실패로 기록
              </button>
              <button
                className="button button-primary"
                onClick={passManualResult}
              >
                성공 후 계속
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
