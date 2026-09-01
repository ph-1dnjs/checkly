import {
  actionText,
  estimateDurationSeconds,
  formatDuration,
  type RunProgress,
  type Scenario,
  type ScenarioRunResult,
  type Step,
} from "../../shared/model/scenario";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";

const PEND_BG = "linear-gradient(180deg, #FFFFFF, #EEF3F7)";
const PASS_BG = "linear-gradient(180deg, #FFFFFF, #E9F5F1)";
const FAIL_BG = "linear-gradient(180deg, #FDF1EE, #F8DED7)";
const RUN_BG = "linear-gradient(180deg, #FFFFFF, #DDEDF8)";
const INK = "#16212E";
const STEP_SHEEN =
  "linear-gradient(90deg, transparent, rgba(255,255,255,.95), rgba(143,192,222,.5), transparent)";

type Props = {
  scenario: Scenario;
  scenarios: Scenario[];
  scenarioResults: ScenarioRunResult[];
  running: boolean;
  manual: Step | null;
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
  onRun: (scenarios?: Scenario[]) => void;
  onImport: () => void;
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
  manualControl,
  manualResult,
  runLog,
  runProgress,
  elapsedSeconds,
  runStartedAt,
  livePreview,
  previewImage,
  onManualBrowserEvent,
  onCompleteManualControl,
  onFailManualControl,
  onRun,
  onImport,
  onCancel,
  onLivePreviewChange,
  runVideos,
  fullRunVideoAvailable,
  onDownloadRunVideo,
  onDownloadFullRunVideo,
}: Props) => {
  const [manualFailureReason, setManualFailureReason] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(true);
  const [queue, setQueue] = useState(scenarios);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState(
    () => new Set(scenarios.map((item) => item.id)),
  );
  const [expandedScenarioId, setExpandedScenarioId] = useState<string | null>(
    null,
  );
  const [selStep, setSelStep] = useState<string | null>(null);
  const manualImageRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    setQueue(scenarios);
    setSelectedScenarioIds(new Set(scenarios.map((item) => item.id)));
  }, [scenarios]);

  useEffect(() => {
    setManualFailureReason("");
  }, [manualControl?.id]);

  const estimatedSeconds = estimateDurationSeconds(scenario);
  const selectedQueue = queue.filter((item) =>
    selectedScenarioIds.has(item.id),
  );
  const queueStepCount = selectedQueue.reduce(
    (total, item) => total + item.steps.length,
    0,
  );
  const moveQueueItem = (id: string, direction: -1 | 1) =>
    setQueue((items) => {
      const index = items.findIndex((item) => item.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= items.length)
        return items;
      const next = [...items];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
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
  const estimatedCompletion = runStartedAt
    ? new Date(runStartedAt + estimatedSeconds * 1000).toLocaleTimeString(
        "ko-KR",
        { hour: "2-digit", minute: "2-digit" },
      )
    : null;
  return (
    <>
      <div className="page-title run-page-title">
        <div>
          <h1>{runComplete ? "실행 완료" : running ? "실행 중" : "실행"}</h1>
        </div>
        <div className="run-header-actions">
          <div className="run-settings-menu">
            <button
              className="button button-secondary"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
            >
              실행 설정{" "}
              <span className="run-settings-summary">Chromium · 1w</span>
              <span>▾</span>
            </button>
            {settingsOpen && (
              <div className="run-settings-popover">
                <p className="eyebrow">BROWSER</p>
                <div className="setting-choice">
                  <button className="selected">Chromium</button>
                  <button>Firefox</button>
                </div>
                <p className="eyebrow">WORKERS</p>
                <div className="setting-choice">
                  <button className="selected">1</button>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={livePreview}
                    onChange={(event) =>
                      onLivePreviewChange(event.target.checked)
                    }
                    disabled={running}
                  />{" "}
                  실시간 테스트 화면
                </label>
                <label className="toggle">
                  <input type="checkbox" /> 실패 즉시 중단
                </label>
              </div>
            )}
          </div>
          {running ? (
            <button className="button danger" onClick={onCancel}>
              실행 취소
            </button>
          ) : (
            <>
              <button
                className="button button-primary"
                onClick={() => onRun(selectedQueue)}
                disabled={!selectedQueue.length}
              >
                ▶ {runComplete ? "다시 실행" : "실행 시작"}
              </button>
            </>
          )}
        </div>
      </div>
      <section className="run-queue" aria-label="실행 큐">
        <div
          className="run-queue-heading"
          role="button"
          tabIndex={0}
          onClick={() => setQueueOpen((open) => !open)}
          aria-expanded={queueOpen}
        >
          <strong>실행 큐</strong>
          <span>
            {selectedQueue.length} / {queue.length} 선택 · {queueStepCount}단계
          </span>
          <span className={`run-queue-caret${queueOpen ? " open" : ""}`}>▾</span>
        </div>
        {queueOpen && (
        <ol>
          {queue.map((item, index) => {
            const isCurrent = item.id === scenario.id;
            const expanded =
              expandedScenarioId === item.id ||
              (isCurrent && (running || runComplete));
            return (
              <li
                key={item.id}
                data-queue-scenario={item.id}
                className={`${isCurrent ? "active" : ""}${expanded ? " expanded" : ""}`}
              >
                <div className="run-queue-row">
                  <button
                    className={`run-queue-check ${selectedScenarioIds.has(item.id) ? "checked" : ""}`}
                    onClick={() =>
                      setSelectedScenarioIds((ids) => {
                        const next = new Set(ids);
                        next.has(item.id)
                          ? next.delete(item.id)
                          : next.add(item.id);
                        return next;
                      })
                    }
                    aria-label={`${item.title} ${selectedScenarioIds.has(item.id) ? "실행 제외" : "실행 포함"}`}
                  >
                    ✓
                  </button>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <button
                    className="run-queue-name"
                    onClick={() =>
                      setExpandedScenarioId((id) =>
                        id === item.id ? null : item.id,
                      )
                    }
                    aria-expanded={expanded}
                  >
                    <strong>{item.title}</strong>
                    <small>{item.title}.md</small>
                    <span className={`run-queue-name-caret${expanded ? " open" : ""}`}>▾</span>
                  </button>
                  <small>{item.steps.length}단계</small>
                  <span className="run-queue-controls">
                    <button
                      onClick={() => moveQueueItem(item.id, -1)}
                      disabled={index === 0}
                      aria-label={`${item.title} 위로`}
                    >
                      ⌃
                    </button>
                    <button
                      onClick={() => moveQueueItem(item.id, 1)}
                      disabled={index === queue.length - 1}
                      aria-label={`${item.title} 아래로`}
                    >
                      ⌄
                    </button>
                  </span>
                </div>
                {expanded && (
                  <ol className="run-queue-steps">
                    {item.steps.map((step, stepIndex) => (
                      <li
                        key={step.id}
                        className={
                          runComplete || stepIndex < runProgress.current
                            ? "passed"
                            : ""
                        }
                      >
                        <span>{step.id}</span>
                        <b>
                          {step.action
                            .toUpperCase()
                            .replace("EXPECTTEXT", "EXPECT")}
                        </b>
                        <em>{actionText(step)}</em>
                        <i aria-label={step.connected ? "연결됨" : "미연결"} />
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
        )}
        {queueOpen && (
        <button className="run-queue-import" onClick={onImport}>
          ＋ 시나리오 파일 불러오기
        </button>
        )}
      </section>
      <div className="run-layout">
        <section className="run-main">
          <div className="run-state">
            <span className={running ? "pulse" : "check"}>
              {running ? "◌" : "✓"}
            </span>
            <div>
              <strong>{progressPercent}%</strong>
              <p>
                {manual || manualControl || manualResult
                  ? manualControl
                    ? `${manualControl.target} 조작을 기다리고 있습니다. (최대 5분)`
                    : manualResult
                      ? `${manualResult.target} 결과를 기다리고 있습니다. (최대 5분)`
                      : `${manual!.target} 값을 기다리고 있습니다.`
                  : scenario.title}
              </p>
            </div>
            {fullRunVideoAvailable && !running && (
              <button
                className="button button-secondary run-video-download"
                onClick={onDownloadFullRunVideo}
              >
                전체 시나리오 영상 다운로드
              </button>
            )}
          </div>
          {runVideos.length > 0 && !running && (
            <section
              className="run-video-list"
              aria-label="시나리오별 실행 영상"
            >
              <div>
                <strong>시나리오별 실행 영상</strong>
                <span>
                  각 시나리오의 실행 영상을 개별로 다운로드할 수 있습니다.
                </span>
              </div>
              <ol>
                {runVideos.map(({ scenario: videoScenario, path }, index) => (
                  <li key={path}>
                    <span>
                      {index + 1}. {videoScenario.title}
                    </span>
                    <button
                      className="button button-secondary"
                      onClick={() => onDownloadRunVideo(path)}
                    >
                      영상 다운로드
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="run-timing">
            <span>
              진행 {runProgress.current}/{runProgress.total}
            </span>
            <span>경과 {formatDuration(elapsedSeconds)}</span>
            <span>
              예상 {formatDuration(estimatedSeconds)}
              {estimatedCompletion ? ` · 완료 ${estimatedCompletion}` : ""}
            </span>
          </div>
          <div
            className="progress"
            aria-label={`실행 진행률 ${progressPercent}%`}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <section
            className="run-step-groups"
            aria-label="시나리오별 실행 단계"
          >
            {scenarios.map((item) => {
              const finished = scenarioResults.find(
                (result) => result.scenario.id === item.id,
              );
              const isCurrentScenario = item.id === scenario.id;
              return (
                <div key={item.id}>
                  <header>
                    <strong>{item.title}</strong>
                    <span>{item.steps.length}단계</span>
                  </header>
                  <ol>
                    {item.steps.map((step, index) => {
                      const failedAt =
                        finished?.status === "failed"
                          ? (finished.failedStepIndex ?? 0)
                          : null;
                      const passed = finished
                        ? finished.status === "passed" ||
                          (failedAt !== null && index < failedAt)
                        : isCurrentScenario && index < runProgress.current;
                      const failed = failedAt !== null && index === failedAt;
                      const current =
                        !finished &&
                        running &&
                        isCurrentScenario &&
                        index === runProgress.current;
                      const stepKey = `${item.id}:${step.id}`;
                      const selected = selStep === stepKey;
                      const hasResult = passed || failed;
                      const bg = selected
                        ? INK
                        : failed
                          ? FAIL_BG
                          : passed
                            ? PASS_BG
                            : current
                              ? RUN_BG
                              : PEND_BG;
                      const fg = selected
                        ? "#FFFFFF"
                        : failed
                          ? "#C1543F"
                          : passed
                            ? "#33806C"
                            : current
                              ? "#2C6C90"
                              : "#AFBDC7";
                      const line = selected
                        ? INK
                        : failed
                          ? "rgba(226,112,92,.4)"
                          : passed
                            ? "rgba(70,163,139,.32)"
                            : current
                              ? "rgba(143,192,222,.7)"
                              : "#E3EAF0";
                      const ring = selected
                        ? "0 4px 14px -6px rgba(22,33,46,.5)"
                        : current
                          ? "0 0 0 3px rgba(143,192,222,.28)"
                          : failed
                            ? "0 0 0 3px rgba(226,112,92,.14)"
                            : "none";
                      return (
                        <li
                          key={step.id}
                          style={{
                            background: bg,
                            color: fg,
                            borderColor: line,
                            boxShadow: ring,
                          }}
                        >
                          <button
                            type="button"
                            title={actionText(step)}
                            aria-label={`${item.title} ${index + 1}단계: ${actionText(step)}`}
                            style={{ cursor: hasResult ? "pointer" : "default" }}
                            onClick={() => {
                              if (!hasResult) return;
                              setSelStep(stepKey);
                              setExpandedScenarioId(item.id);
                              document
                                .querySelector(
                                  `[data-queue-scenario="${item.id}"]`,
                                )
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                });
                            }}
                          >
                            {step.id}
                          </button>
                          {current && (
                            <div
                              className="step-sheen"
                              style={{
                                background: STEP_SHEEN,
                                animation: "ckLight 1.5s ease-in-out infinite",
                              }}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </section>
          {
            <section className="live-preview" aria-label="실시간 테스트 화면">
              <div>
                <strong>
                  {manualControl ? "브라우저 직접 제어" : "실시간 테스트 화면"}
                </strong>
                <span>
                  {manualControl
                    ? manualControl.prompt ||
                      `${manualControl.target}에서 필요한 절차를 완료해 주세요.`
                    : "단계마다 캡처되어 실행 속도가 다소 느려질 수 있습니다."}
                </span>
              </div>
              {previewImage ? (
                <img
                  ref={manualImageRef}
                  className={manualControl ? "manual-browser-screen" : ""}
                  src={previewImage}
                  alt={
                    manualControl
                      ? "직접 조작할 브라우저 화면"
                      : "현재 테스트 실행 화면"
                  }
                  tabIndex={manualControl ? 0 : -1}
                  onClick={
                    manualControl
                      ? (event) => {
                          const point = browserPoint(event);
                          if (point)
                            onManualBrowserEvent({ type: "click", ...point });
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
                          if (text)
                            onManualBrowserEvent({ type: "text", text });
                        }
                      : undefined
                  }
                />
              ) : (
                <p>첫 실행 화면을 기다리고 있습니다.</p>
              )}
              {manualControl && (
                <div className="manual-browser-actions">
                  <input
                    value={manualFailureReason}
                    onChange={(event) =>
                      setManualFailureReason(event.target.value)
                    }
                    placeholder="실패 시 사유를 입력하세요"
                  />
                  <button
                    className="button danger"
                    disabled={!manualFailureReason.trim()}
                    onClick={() =>
                      onFailManualControl(manualFailureReason.trim())
                    }
                  >
                    실패로 기록
                  </button>
                  <button
                    className="button button-primary"
                    onClick={onCompleteManualControl}
                  >
                    완료 후 계속
                  </button>
                </div>
              )}
            </section>
          }
          <div className="log-box" aria-live="polite">
            {runLog.length ? (
              runLog.map((log, index) => (
                <p key={index}>
                  <time>{String(index + 9).padStart(2, "0")}:24</time>
                  {log}
                </p>
              ))
            ) : (
              <p className="muted">실행 로그가 여기에 표시됩니다.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
};
