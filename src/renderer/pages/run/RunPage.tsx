import {
  actionText,
  type RunProgress,
  type Scenario,
  type ScenarioRunResult,
  type Step,
} from "../../shared/model/scenario";
import {
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";

const ACCENT = "#17607F";
const PASS = "#1E7A4A";
const FAIL = "#B32318";
const WAIT = "#C08A15";
const INK = "#14181C";
const IDLE = "#A6AEB5";

type Props = {
  scenario: Scenario;
  scenarios: Scenario[];
  scenarioResults: ScenarioRunResult[];
  running: boolean;
  manual: Step | null;
  manualValue: string;
  manualValueVisible: boolean;
  onManualValueChange: (value: string) => void;
  onToggleManualValueVisible: () => void;
  onSubmitManualInput: () => void;
  onCancelManual: () => void;
  manualControl: Step | null;
  manualResult: Step | null;
  runLog: string[];
  runProgress: RunProgress;
  elapsedSeconds: number;
  runStartedAt: number | null;
  livePreview: boolean;
  previewImage: string;
  onManualBrowserEvent: (event: {
    type: "click" | "wheel" | "key" | "text";
    x?: number;
    y?: number;
    deltaY?: number;
    key?: string;
    text?: string;
  }) => void;
  onCompleteManualControl: () => void;
  onFailManualControl: (reason: string) => void;
  onGoToPicker: () => void;
  onCancel: () => void;
  onLivePreviewChange: (value: boolean) => void;
  runVideos: Array<{ scenario: Scenario; path: string }>;
  fullRunVideoAvailable: boolean;
  onDownloadRunVideo: (path: string) => void;
  onDownloadFullRunVideo: () => void;
};

export const RunPage = ({
  scenario,
  scenarios,
  scenarioResults,
  running,
  manual,
  manualValue,
  manualValueVisible,
  onManualValueChange,
  onToggleManualValueVisible,
  onSubmitManualInput,
  onCancelManual,
  manualControl,
  manualResult,
  runLog,
  runProgress,
  livePreview,
  previewImage,
  onManualBrowserEvent,
  onCompleteManualControl,
  onFailManualControl,
  onGoToPicker,
  onCancel,
  onLivePreviewChange,
  runVideos,
  fullRunVideoAvailable,
  onDownloadRunVideo,
  onDownloadFullRunVideo,
}: Props) => {
  const [manualFailureReason, setManualFailureReason] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selStep, setSelStep] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<"ALL" | "ERR">("ALL");
  const manualImageRef = useRef<HTMLImageElement | null>(null);

  const browserPoint = (
    event: MouseEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>,
  ) => {
    const image = manualImageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return null;
    const bounds = image.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * image.naturalWidth,
      y: ((event.clientY - bounds.top) / bounds.height) * image.naturalHeight,
    };
  };
  const handleManualKey = (event: KeyboardEvent<HTMLImageElement>) => {
    if (!manualControl) return;
    event.preventDefault();
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      onManualBrowserEvent({ type: "text", text: event.key });
      return;
    }
    const key = event.key === " " ? "Space" : event.key;
    const modifiers = `${event.metaKey ? "Meta+" : event.ctrlKey ? "Control+" : event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}`;
    onManualBrowserEvent({ type: "key", key: `${modifiers}${key}` });
  };

  const progressPercent = runProgress.total
    ? Math.round((runProgress.current / runProgress.total) * 100)
    : 0;
  const runComplete =
    !running &&
    runProgress.total > 0 &&
    runProgress.current >= runProgress.total;
  const awaiting = Boolean(manual || manualControl || manualResult);
  const failedAny = scenarioResults.some((result) => result.status === "failed");
  const stateWord = awaiting
    ? "WAITING"
    : running
      ? "RUNNING"
      : runComplete
        ? failedAny
          ? "FAILED"
          : "PASSED"
        : "IDLE";
  const stateColor =
    stateWord === "WAITING"
      ? WAIT
      : stateWord === "RUNNING"
        ? ACCENT
        : stateWord === "FAILED"
          ? FAIL
          : stateWord === "PASSED"
            ? PASS
            : IDLE;
  const canStop = running;
  const canReplay = !running;

  const currentStep = scenario.steps[runProgress.current];
  const nowAction = currentStep
    ? actionText(currentStep)
    : runComplete
      ? "완료"
      : "대기 중";

  const groups = scenarios.map((item) => {
    const finished = scenarioResults.find(
      (result) => result.scenario.id === item.id,
    );
    const isCurrentScenario = item.id === scenario.id;
    const steps = item.steps.map((step, index) => {
      const failedAt =
        finished?.status === "failed" ? (finished.failedStepIndex ?? 0) : null;
      const passed = finished
        ? finished.status === "passed" || (failedAt !== null && index < failedAt)
        : isCurrentScenario && index < runProgress.current;
      const failed = failedAt !== null && index === failedAt;
      const isRunning =
        !finished && running && isCurrentScenario && index === runProgress.current;
      const isWaiting = isRunning && awaiting;
      const stepKey = `${item.id}:${step.id}`;
      const selected = selStep === stepKey;
      const hasResult = passed || failed;
      return {
        step,
        index,
        stepKey,
        dot: failed
          ? FAIL
          : passed
            ? PASS
            : isWaiting
              ? WAIT
              : isRunning
                ? ACCENT
                : "#D3D8DD",
        bar: selected
          ? INK
          : failed
            ? FAIL
            : isWaiting
              ? WAIT
              : isRunning
                ? ACCENT
                : "transparent",
        rowBg: selected
          ? "#F0F3F5"
          : isWaiting
            ? "#FDFBF6"
            : isRunning
              ? "#F5F9FB"
              : failed
                ? "#FDF6F5"
                : "transparent",
        opFg: failed ? "#9A2A20" : "#7A838D",
        targetFg: hasResult || isRunning ? "#14181C" : "#8A939C",
        pulsing: isRunning,
        cursor: hasResult ? "pointer" : "default",
        onClick: hasResult ? () => setSelStep(stepKey) : undefined,
      };
    });
    const groupState = finished
      ? finished.status === "failed"
        ? "fail"
        : "pass"
      : isCurrentScenario && running
        ? "run"
        : "pend";
    return {
      scenario: item,
      steps,
      dot:
        groupState === "fail"
          ? FAIL
          : groupState === "run"
            ? ACCENT
            : groupState === "pass"
              ? PASS
              : "#D3D8DD",
    };
  });

  const filteredLog =
    logFilter === "ALL" ? runLog : runLog.filter((line) => line.includes("실패"));

  return (
    <div className="run">
      <div className="run-top">
        <div className="run-state-word">
          <span className="run-state-dot" style={{ background: stateColor }} />
          <span style={{ color: stateColor }}>{stateWord}</span>
        </div>
        <div className="run-now-scenario">{scenario.title}</div>
        <div className="run-now-action">{nowAction}</div>
        <div className="run-top-right">
          <div className="run-progress-readout">
            <div className="run-progress-pct" style={{ color: stateColor }}>
              {progressPercent}%
            </div>
            <div className="run-progress-steps">
              {runProgress.current}/{runProgress.total}
            </div>
          </div>
          {canStop && (
            <button className="run-stop-btn" onClick={onCancel}>
              <span className="msi">stop</span>
              중단
            </button>
          )}
          {canReplay && (
            <button className="button button-secondary" onClick={onGoToPicker}>
              시나리오 다시 선택
            </button>
          )}
          <div className="run-settings-menu">
            <button
              className="run-settings-btn"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
            >
              Chromium · 1w
            </button>
            {settingsOpen && (
              <div className="run-settings-popover">
                <div className="run-settings-group">
                  <p>BROWSER</p>
                  <div className="setting-choice">
                    <button className="selected">Chromium</button>
                    <button>WebKit</button>
                    <button>Firefox</button>
                  </div>
                </div>
                <div className="run-settings-group">
                  <p>WORKERS</p>
                  <div className="setting-choice">
                    <button className="selected">1</button>
                    <button>2</button>
                    <button>4</button>
                  </div>
                </div>
                <label className="run-settings-toggle">
                  <input
                    type="checkbox"
                    checked={livePreview}
                    onChange={(event) => onLivePreviewChange(event.target.checked)}
                    disabled={running}
                  />
                  실행 화면 표시
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="run-tape">
        {groups.flatMap((group) => group.steps).map((row) => (
          <div
            key={row.stepKey}
            className="run-tape-bar"
            style={{ background: row.dot }}
            title={`step ${row.index + 1}`}
          />
        ))}
      </div>

      {manual && (
        <div className="run-manual-banner">
          <div>
            <div className="run-manual-kicker">
              MANUAL INPUT REQUIRED · STEP {runProgress.current + 1}
            </div>
            <div className="run-manual-label">
              {manual.prompt || `${manual.target}를 입력해 주세요.`}
            </div>
          </div>
          <div className="run-manual-actions">
            <input
              autoFocus
              type={manualValueVisible ? "text" : "password"}
              value={manualValue}
              onChange={(event) => onManualValueChange(event.target.value)}
              placeholder="입력값"
            />
            <label className="run-manual-visible">
              <input
                type="checkbox"
                checked={manualValueVisible}
                onChange={onToggleManualValueVisible}
              />
              표시
            </label>
            <button className="button button-primary" onClick={onSubmitManualInput}>
              입력 완료 · 계속
            </button>
            <button className="run-manual-skip" onClick={onCancelManual}>
              취소
            </button>
          </div>
        </div>
      )}

      {fullRunVideoAvailable && !running && (
        <div className="run-video-bar">
          <button className="button button-secondary" onClick={onDownloadFullRunVideo}>
            전체 시나리오 영상 다운로드
          </button>
          {runVideos.map(({ scenario: videoScenario, path }) => (
            <button
              key={path}
              className="button button-secondary"
              onClick={() => onDownloadRunVideo(path)}
            >
              {videoScenario.title} 영상
            </button>
          ))}
        </div>
      )}

      <div className="run-cols">
        <div className="run-execution">
          <div className="run-col-head">
            <span>EXECUTION</span>
            <span className="run-col-head-meta">
              {runProgress.current}/{runProgress.total} steps
            </span>
            {selStep && (
              <button className="run-live-return" onClick={() => setSelStep(null)}>
                LIVE로 복귀
              </button>
            )}
          </div>
          <div className="run-execution-body">
            {groups.map((group) => (
              <div key={group.scenario.id}>
                <div className="run-group-head">
                  <span className="run-group-dot" style={{ background: group.dot }} />
                  <span>{group.scenario.title}</span>
                  <span className="run-group-count">{group.scenario.steps.length}단계</span>
                </div>
                {group.steps.map((row) => (
                  <button
                    key={row.stepKey}
                    type="button"
                    className="run-step-row"
                    title={`${group.scenario.title} #${row.index + 1} ${actionText(row.step)}`}
                    style={{
                      cursor: row.cursor,
                      background: row.rowBg,
                      borderLeftColor: row.bar,
                    }}
                    onClick={row.onClick}
                  >
                    <span
                      className={`run-step-dot${row.pulsing ? " pulsing" : ""}`}
                      style={{ background: row.dot }}
                    />
                    <span className="run-step-n">{row.index + 1}</span>
                    <span className="run-step-op" style={{ color: row.opFg }}>
                      {row.step.action.toUpperCase().replace("EXPECTTEXT", "EXPECT")}
                    </span>
                    <span className="run-step-target" style={{ color: row.targetFg }}>
                      {actionText(row.step)}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="run-side">
          {livePreview && (
            <div className="run-viewport">
              <div className="run-col-head">
                <span>VIEWPORT</span>
                <span
                  className="run-col-head-meta"
                  style={{ marginLeft: "auto", color: stateColor }}
                >
                  {selStep
                    ? "REPLAY"
                    : awaiting
                      ? "PAUSED"
                      : running
                        ? "CAPTURING"
                        : "IDLE"}
                </span>
                <button className="run-live-return" onClick={() => onLivePreviewChange(false)}>
                  숨기기
                </button>
              </div>
              <div className="run-viewport-body">
                {previewImage ? (
                  <img
                    ref={manualImageRef}
                    className={manualControl ? "manual-browser-screen" : ""}
                    src={previewImage}
                    alt={
                      manualControl ? "직접 조작할 브라우저 화면" : "현재 테스트 실행 화면"
                    }
                    tabIndex={manualControl ? 0 : -1}
                    onClick={
                      manualControl
                        ? (event) => {
                            const point = browserPoint(event);
                            if (point) onManualBrowserEvent({ type: "click", ...point });
                            event.currentTarget.focus();
                          }
                        : undefined
                    }
                    onWheel={
                      manualControl
                        ? (event) => {
                            event.preventDefault();
                            const point = browserPoint(event);
                            if (point)
                              onManualBrowserEvent({
                                type: "wheel",
                                deltaY: event.deltaY,
                                ...point,
                              });
                          }
                        : undefined
                    }
                    onKeyDown={manualControl ? handleManualKey : undefined}
                    onPaste={
                      manualControl
                        ? (event: ClipboardEvent<HTMLImageElement>) => {
                            event.preventDefault();
                            const text = event.clipboardData.getData("text");
                            if (text) onManualBrowserEvent({ type: "text", text });
                          }
                        : undefined
                    }
                  />
                ) : (
                  <div className="run-viewport-caption">NO ACTIVE SESSION</div>
                )}
                {manualControl && (
                  <div className="manual-browser-actions">
                    <input
                      value={manualFailureReason}
                      onChange={(event) => setManualFailureReason(event.target.value)}
                      placeholder="실패 시 사유를 입력하세요"
                    />
                    <button
                      className="button danger"
                      disabled={!manualFailureReason.trim()}
                      onClick={() => onFailManualControl(manualFailureReason.trim())}
                    >
                      실패로 기록
                    </button>
                    <button className="button button-primary" onClick={onCompleteManualControl}>
                      완료 후 계속
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="run-console">
            <div className="run-col-head run-console-head">
              <span>CONSOLE</span>
              <div className="run-log-filters">
                {(["ALL", "ERR"] as const).map((f) => (
                  <button
                    key={f}
                    className={logFilter === f ? "active" : ""}
                    onClick={() => setLogFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {!livePreview && (
                <button
                  className="run-live-return run-live-return-dark"
                  onClick={() => onLivePreviewChange(true)}
                >
                  VIEWPORT 표시
                </button>
              )}
            </div>
            <div className="run-console-body">
              {filteredLog.length ? (
                filteredLog.map((log, index) => (
                  <div className="run-log-line" key={index}>
                    {log}
                  </div>
                ))
              ) : (
                <div className="run-log-line run-log-muted">
                  실행 로그가 여기에 표시됩니다.
                </div>
              )}
              {running && <div className="run-log-cursor">▌</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
