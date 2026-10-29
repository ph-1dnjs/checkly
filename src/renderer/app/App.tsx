import type { CSSProperties, ReactElement } from "react";
import { Button } from "../shared/ui/Button";
import { useEffect, useState } from "react";
import type { ApiRunAction } from "../shared/model/run-action";
import { DashboardPage } from "../pages/dashboard/DashboardPage";
import { ScenarioEditorPage } from "../pages/editor/ScenarioEditorPage";
import { RunPage } from "../pages/run/RunPage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import { ScenarioPickerPage, pickedScenarioGroups, recordScenarios } from "../pages/picker/ScenarioPickerPage";
import { FormAutomationPage } from "../pages/form-automation/FormAutomationPage";
import { BottomNavigation } from "../widgets/BottomNavigation";
import { ScenarioWorkspaceHeaderExtra } from "../widgets/ScenarioWorkspaceHeaderExtra";
import { PageLayout } from "../shared/ui/PageLayout";
import { ScenarioList } from "../widgets/ScenarioList";
import { useScenarioEnvironment } from "./hooks/useScenarioEnvironment";
import { isScenarioWorkspaceRoute } from "../shared/model/scenario";
import { RunReportDrawer } from "../widgets/RunReportDrawer";
import { RunReportViewer } from "../widgets/RunReportViewer";
import "../shared/model/electron-api";
import { useNavigation } from "./hooks/useNavigation";
import { useScenarioState } from "./hooks/useScenarioState";
import { useRunOrchestration } from "./hooks/useRunOrchestration";
import { EnvironmentMenu } from "../widgets/EnvironmentMenu";
import { ApiTestingPage } from "../pages/api-testing/ApiTestingPage";
import { AuthScreen } from "../pages/auth/AuthScreen";
import { AuthUnavailable } from "../pages/auth/AuthUnavailable";
import type { AuthAccount } from "../pages/auth/model";
import { useAuth } from "./hooks/useAuth";

import { Input } from "../shared/ui/Input";
const Workspace = ({ account }: { account: AuthAccount | null }): ReactElement => {
  const [apiRunAction, setApiRunAction] = useState<ApiRunAction | null>(null);
  const [keepSessionPromptChecked, setKeepSessionPromptChecked] =
    useState(false);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const {
    route,
    setRoute,
    lastWorkspaceRoute,
    lastRunRoute,
    toast,
    showToast,
  } = useNavigation();
  const environment = useScenarioEnvironment(account?.session.projectId, showToast);
  const scenarioState = useScenarioState({ projectId: account?.session.projectId, route, showToast, resolveBaseUrl: environment.baseUrlFor, defaultEndpointId: environment.defaultEndpointId });
  const [pickedKeys, setPickedKeys] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const runOrchestration = useRunOrchestration({ showToast, setRoute, projectId: account?.session.projectId });

  // 폼 자동 완성에서는 현재 웹뷰만 새로고침하고, 다른 화면에서는 앱을 새로고침한다.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        route === "form-automation" ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.code !== "KeyR"
      )
        return;
      event.preventDefault();
      if (!event.repeat) window.location.reload();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [route]);

  const {
    scenario,
    sourceMarkdown,
    isDirty,
    records, activeRecord, loading, busy, refreshRecords, openRecord, newRecord, saveRecord, deleteRecord, duplicateRecord, importMarkdown,
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
    commitEditorRunSnapshot,
    placeMarker,
    updateMarker,
    closeMarkerDialog,
    completeMarker,
    saveMarkerEditsAndReturn,
    selectMarkerScenario,
    reorderSteps,
    duplicateScenario,
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
    lastRunRecord,
    reportRecord,
    setReportRecord,
    downloadRunReport,
    runQueue,
    runValidationError,
    setRunValidationError,
    keepSession,
    setKeepSession,
    sessionActive,
    endSession,
    sessionPromptOpen,
    resolveSessionPrompt,
    runTimeline,
    stackPaused,
    queueRerun,
    removeFromStack,
    clearDoneRecords,
    pauseStack,
    resumeStack,
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

  const runScenarios = (items: typeof executableScenarios, trigger: "editor" | "picker" = "picker") => {
    if (!account) { showToast("웹 시나리오를 사용하려면 로그인해 주세요."); return; }
    const resolved = environment.resolve(items, trigger === "picker" ? environment.runEndpointId : undefined);
    if (resolved) beginRuns(resolved, false, trigger);
  };
  const runEditorContent = () => runScenarios(commitEditorRunSnapshot(), "editor");
  const inWorkspace = isScenarioWorkspaceRoute(route);
  const awaitingManual = Boolean(manual || manualControl || manualResult);
  const pickedScenarios = pickedScenarioGroups(records.map(record => ({ record, scenarios: recordScenarios(record) })), pickedKeys).flatMap(group => group.scenarios);
  const openRequested = (id: string) => {
    if (id === "new") newRecord();
    else if (id === "refresh") { void refreshRecords(true); void environment.refresh(); }
    else openRecord(id);
  };
  const requestOpenRecord = (id: string) => {
    if (busy || id === activeRecord?.id) return;
    if (isDirty) return setPendingOpenPath(id);
    openRequested(id);
  };
  useEffect(() => {
    if (route !== "editor" || !account) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.code !== "KeyS") return;
      event.preventDefault();
      if (!event.repeat) void saveRecord();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <main
      className={`workspace${inWorkspace ? " scenario-workspace" : ""}${route === "form-automation" ? " form-automation-workspace" : ""}`}
    >
      <section className="content">
        {route === "api-testing" && <ApiTestingPage onRunAction={setApiRunAction} onOpenSettings={() => setRoute("settings")} />}
        {route === "dashboard" && (
          <DashboardPage
            history={runHistory}
            summary={runSummary}
            onOpenRun={() => setRoute("run")}
            onOpenReport={setOpenRunRecord}
          />
        )}
        {inWorkspace && !account && <div className="picker-empty-state"><h2>로그인이 필요합니다</h2><p>웹 시나리오는 팀 프로젝트 DB에 저장됩니다. Supabase 연결을 설정하고 프로젝트에 로그인해 주세요.</p></div>}
        {inWorkspace && account && (
          <PageLayout
            icon="fact_check"
            title="시나리오"
            extra={
              <ScenarioWorkspaceHeaderExtra
                route={route}
                editorMode={editorMode}
                lastRunRoute={lastRunRoute}
                onNavigate={setRoute}
                onEditorModeChange={(mode) => {
                  if (mode === editorMode) return;
                  if (mode === "text") setSaveBeforeReturning(true);
                  else setEditorMode(mode);
                }}
                running={running}
                awaiting={awaitingManual}
                progressPercent={runProgressPercent}
                progressSteps={`${runProgress.current}/${runProgress.total}`}
                pickedCount={pickedScenarios.length}
                isDirty={isDirty}
                onSave={() => saveRecord()}
                busy={busy || loading}
                canDelete={Boolean(activeRecord || sourceMarkdown.trim())}
                onDelete={() => setConfirmDelete(true)}
                onDuplicate={duplicateRecord}
                onImportMarkdown={importMarkdown}
                keepSession={keepSession}
                onKeepSessionChange={setKeepSession}
                sessionActive={sessionActive}
                onEndSession={endSession}
                livePreview={livePreview}
                onLivePreviewChange={setLivePreview}
                environment={
                  <div className="scenario-environment" title={environment.endpoints.length ? "실행 환경 · 설정 > 엔드포인트 × 환경" : "설정에서 웹 엔드포인트와 환경별 주소를 넣어 주세요."}>
                    {!environment.endpoints.length && <span className="msi scenario-environment-warn" aria-label="웹 엔드포인트 없음">warning</span>}
                    <span>{account?.session.projectCode}</span>
                    <select
                      aria-label="웹 사이트"
                      disabled={busy || loading || running || (route === "editor" && !scenario.title)}
                      value={route === "editor" ? scenario.endpointId ?? environment.defaultEndpointId : environment.runEndpointId}
                      onChange={event => route === "editor" ? scenarioState.selectEndpoint(event.target.value) : environment.setRunEndpointId(event.target.value)}
                    >
                      {route !== "editor" && <option value="">시나리오별 웹 사이트</option>}
                      {!environment.endpoints.length && <option value="">등록된 웹 사이트 없음</option>}
                      {route === "editor" && scenario.endpointId && !environment.endpoints.some(item => item.id === scenario.endpointId) && <option value={scenario.endpointId}>삭제된 웹 사이트</option>}
                      {environment.endpoints.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <EnvironmentMenu
                      project={environment.menuProject}
                      environmentId={environment.environmentId}
                      label="시나리오 환경"
                      disabled={busy || loading || running}
                      serverId={route === "editor" ? scenario.endpointId ?? environment.defaultEndpointId : environment.runEndpointId || undefined}
                      onSelect={id => environment.select({ environmentId: id })}
                    />
                  </div>
                }
              />
            }
          >
            <div className="ws-page">
        {route === "editor" && (
          <ScenarioEditorPage
            mode={editorMode}
            scenario={scenario}
            sourceMarkdown={sourceMarkdown}
            baseUrl={environment.baseUrlFor(scenario.endpointId)}
            resolveBaseUrl={environment.baseUrlFor}
            webEndpoints={environment.endpoints}
            defaultEndpointId={environment.defaultEndpointId}
            sidebar={<ScenarioList records={records} activeId={activeRecord?.id ?? null} loading={loading} busy={busy}
              draftTitle={activeRecord || !sourceMarkdown.trim() ? undefined : previews[0]?.title ?? ""} dirty={isDirty} onDelete={() => setConfirmDelete(true)}
              onSelect={requestOpenRecord} onNew={() => requestOpenRecord("new")} onRefresh={() => requestOpenRecord("refresh")} />}
            previews={previews}
            markerScenarioId={markerScenarioId || previews[0]?.id || ""}
            selectedId={selectedId}
            isAddingMarker={isAddingMarker}
            markersVisible={markersVisible}
            markerDialog={markerDialog}
            pendingMarker={pendingMarker}
            onSelectMarkerScenario={selectMarkerScenario}
            onSelectUploadFile={() => window.electronAPI.selectUploadFile()}
            onSourceChange={updateSource}
            onScenarioChange={setScenario}
            onBeginMarkerPlacement={() => setIsAddingMarker(true)}
            onCancelMarkerPlacement={() => setIsAddingMarker(false)}
            onToggleMarkersVisible={() =>
              setMarkersVisible((visible) => !visible)
            }
            onPlaceMarker={placeMarker}
            onDeleteLast={() => updateSteps(scenario.steps.slice(0, -1))}
            onClearSteps={() => updateSteps([])}
            onSelectStep={setSelectedId}
            onEditStep={setEditingMarker}
            onDeleteStep={(id) =>
              updateSteps(scenario.steps.filter((step) => step.id !== id))
            }
            onReorderSteps={reorderSteps}
            onUpdateMarkerDialog={updateMarker}
            onCloseMarkerDialog={closeMarkerDialog}
            onCompleteMarkerDialog={completeMarker}
            onDuplicateScenario={duplicateScenario}
          />
        )}
        {route === "picker" && (
          <ScenarioPickerPage
            records={records}
            loading={loading}
            pickedKeys={pickedKeys}
            onPick={setPickedKeys}
            onOpenEditor={() => setRoute("editor")}
            onRefresh={() => { void refreshRecords(); void environment.refresh(); }}
            onRun={runScenarios}
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
            onRerunScenario={queueRerun}
            runTimeline={runTimeline}
            stackPaused={stackPaused}
            onRemoveFromStack={removeFromStack}
            onClearDoneRecords={clearDoneRecords}
            onPauseStack={pauseStack}
            onResumeStack={resumeStack}
            previewImage={previewImage}
            stepPreviews={stepPreviews}
            onManualBrowserEvent={(event) =>
              void window.electronAPI.controlManualBrowser(event)
            }
            onSetViewport={(width, height) =>
              void runOrchestration.setViewport({ width, height })
            }
            onCompleteManualControl={completeManualControl}
            onFailManualControl={failManualControl}
            onCancel={cancelRuns}
            onPopout={popoutViewport}
            onLivePreviewChange={setLivePreview}
            runVideos={runVideos}
            fullRunVideoAvailable={Boolean(fullRunVideoPath)}
            onDownloadRunVideo={downloadRunVideo}
            onDownloadFullRunVideo={downloadFullRunVideo}
            reportAvailable={Boolean(lastRunRecord)}
            onOpenReport={() => setReportRecord(lastRunRecord)}
            onGoPick={() => setRoute("picker")}
          />
        )}
            </div>
          </PageLayout>
        )}
        {route === "settings" && <SettingsPage scenario={scenario} account={account} />}
        {route === "form-automation" && <FormAutomationPage />}
      </section>
      <RunReportDrawer
        record={openRunRecord}
        onClose={() => setOpenRunRecord(null)}
        onOpenReport={setReportRecord}
        onRerun={(scenarios) => {
          setOpenRunRecord(null);
          const record = openRunRecord;
          void (async () => {
            if (record?.viewport) await runOrchestration.setViewport(record.viewport);
            if (record?.sessionKept !== undefined) runOrchestration.setKeepSession(record.sessionKept);
            beginRuns(scenarios, false, "rerun");
          })().catch(error => showToast(error instanceof Error ? error.message : "재실행 환경을 설정하지 못했습니다."));
        }}
      />
      <RunReportViewer
        record={reportRecord}
        onClose={() => setReportRecord(null)}
        onDownload={downloadRunReport}
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
          <Button variant="ghost" iconOnly
            className="run-notification-close"
            onClick={() => setRunNotification(null)}
            aria-label="실행 알림 닫기"
          >
            ×
          </Button>
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
          <Button
            variant="secondary"
            className="run-notification-link"
            onClick={() => setRoute("run")}
          >
            바로가기 <span aria-hidden="true">→</span>
          </Button>
        </section>
      )}
      <BottomNavigation
        apiRunAction={apiRunAction}
        route={route}
        lastWorkspaceRoute={lastWorkspaceRoute}
        running={running}
        onNavigate={setRoute}
        onRun={() => {
          if (route === "run") return beginRuns(runQueue);
          if (route === "editor") return runEditorContent();
          return runScenarios(pickedScenarios);
        }}
        onCancel={cancelRuns}
      />
      {sessionPromptOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="keep-session-prompt-title"
        >
          <div className="manual-modal">
            <h2 id="keep-session-prompt-title">
              실행하기 전에 세션을 유지하시겠습니까?
            </h2>
            <p>
              켜두면 로그인 등으로 만들어진 브라우저 세션을 다음 실행에도 그대로
              이어받아, 2차 인증이 필요한 시나리오를 반복 실행할 때 매번 다시
              로그인하지 않아도 됩니다.
            </p>
            <label className="session-prompt-toggle">
              <span>다시 묻지 않기</span>
              <input
                type="checkbox"
                checked={keepSessionPromptChecked}
                onChange={(event) =>
                  setKeepSessionPromptChecked(event.target.checked)
                }
              />
            </label>
            <div className="modal-actions">
              <Button variant="secondary"
                onClick={() => {
                  resolveSessionPrompt(false, keepSessionPromptChecked);
                  setKeepSessionPromptChecked(false);
                }}
              >
                닫기
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  resolveSessionPrompt(true, keepSessionPromptChecked);
                  setKeepSessionPromptChecked(false);
                }}
              >
                세션 유지
              </Button>
            </div>
          </div>
        </div>
      )}
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
              <Button variant="primary" onClick={() => setRunValidationError(null)}>
                확인
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-scenario-title">
          <div className="manual-modal"><h2 id="delete-scenario-title">시나리오 삭제</h2>
            <p>{activeRecord ? `“${activeRecord.title}”을 팀 DB에서 삭제하시겠습니까?` : `저장 전 시나리오 “${previews[0]?.title || "제목 없는 시나리오"}”을 삭제하시겠습니까? 작성한 내용은 사라집니다.`}</p>
            <div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>취소</Button>
              <Button variant="danger" disabled={busy} onClick={async () => { await deleteRecord(); setConfirmDelete(false); }}>삭제</Button></div>
          </div>
        </div>
      )}
      {pendingOpenPath && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-scenario-title"
        >
          <div className="manual-modal">
            <h2 id="open-scenario-title">저장하지 않은 변경 사항이 있습니다</h2>
            <p>계속하면 지금 편집 중인 변경 사항이 사라집니다.</p>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setPendingOpenPath(null)}>취소</Button>
              <Button
                variant="primary"
                onClick={() => {
                  openRequested(pendingOpenPath);
                  setPendingOpenPath(null);
                }}
              >
                저장하지 않고 열기
              </Button>
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
              <Button variant="secondary" onClick={() => setSaveBeforeReturning(false)}>
                취소
              </Button>
              <Button variant="secondary"
                onClick={() => {
                  setSaveBeforeReturning(false);
                  setEditorMode("text");
                }}
              >
                저장하지 않고 돌아가기
              </Button>
              <Button
                variant="primary"
                onClick={() => void saveMarkerEditsAndReturn()}
              >
                저장 후 돌아가기
              </Button>
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
              <Input
                autoFocus
                value={manualFailureReason}
                onChange={(event) => setManualFailureReason(event.target.value)}
                placeholder="실패 시 사유를 입력하세요"
              />
            </label>
            <div className="modal-actions">
              <Button
                variant="danger"
                disabled={!manualFailureReason.trim()}
                onClick={failManualResult}
              >
                실패로 기록
              </Button>
              <Button variant="primary" onClick={passManualResult}>
                성공 후 계속
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

// 팀 프로젝트(Supabase)가 켜져 있으면 로그인해야 앱을 보여준다. 꺼져 있거나 bridge가 없으면 지금처럼 바로 앱을 연다.
export const App = (): ReactElement => {
  const auth = useAuth();
  if (auth.status === "checking") return <main className="auth-pending" aria-busy="true" />;
  if (auth.status === "unavailable")
    return <AuthUnavailable message={auth.error} retrying={auth.retrying} onRetry={auth.retry} />;
  if (auth.status === "signed-out" && auth.bridge)
    return <AuthScreen bridge={auth.bridge} onEnter={auth.enter} />;
  return (
    <>
      <Workspace account={auth.account} />
      {auth.joining && auth.bridge && (
        <AuthScreen bridge={auth.bridge} initialMode="join" onEnter={auth.enter} onExit={auth.closeJoin} />
      )}
    </>
  );
};
