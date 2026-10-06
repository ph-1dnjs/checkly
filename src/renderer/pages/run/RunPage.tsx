import {
  actionText,
  type RunProgress,
  type Scenario,
  type ScenarioRunResult,
  type Step,
} from "../../shared/model/scenario";
import type { RunTimelineEntry } from "../../app/hooks/useRunOrchestration";
import { ActionTag } from "../../shared/ui/ActionTag";
import { Button } from "../../shared/ui/Button";
import { Popover } from "../../shared/ui/Popover";
import {
  useEffect,
  useLayoutEffect,
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
const RQ_ACTIVE = "#1F63AE";
const RQ_QUEUED = "#AD6800";
const RQ_IDLE_DOT = "#D3D8DD";
const LOG_DEFAULT = "#E7EAED";
const LOG_MUTED = "#98A4AE";
const LOG_PASS = "#7FD8A6";
const LOG_WAIT = "#EBC46B";
const LOG_FAIL = "#F09B92";

// CONSOLE 로그 한 줄의 내용을 보고 톤을 정한다: 실패/통과/대기 중 단계는 눈에 띄는
// 색으로, 시작·취소 같은 안내성 줄은 옅은 회색으로, 나머지 일반 단계 줄은 기본색으로 표시한다.
const logLineColor = (line: string): string => {
  if (line.includes("실패")) return LOG_FAIL;
  if (line.includes("통과")) return LOG_PASS;
  if (line.includes("대기")) return LOG_WAIT;
  if (line.includes("취소") || line.includes("시작")) return LOG_MUTED;
  return LOG_DEFAULT;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");
const fmtElapsed = (seconds: number): string =>
  `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;

type FitMode = "fit" | "width" | "actual";

const VIEWPORT_PRESETS: Array<{
  key: string;
  w: number;
  h: number;
  label: string;
  title: string;
}> = [
  { key: "2560x1440", w: 2560, h: 1440, label: "2560×1440", title: "QHD" },
  { key: "1920x1080", w: 1920, h: 1080, label: "1920×1080", title: "와이드" },
];

const FIT_MODES: Array<{ key: FitMode; label: string; title: string }> = [
  {
    key: "fit",
    label: "맞춘",
    title: "가로·세로 모두 들어가는 배율로 축소 (기본)",
  },
  {
    key: "width",
    label: "너비",
    title: "패널 너비에 맞춰 표시 · 세로는 스크롤",
  },
  { key: "actual", label: "1:1", title: "원본 픽셀 크기 · 직접 제어 시 권장" },
];

const CHROME_H = 22;

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
  keepSession: boolean;
  onKeepSessionChange: (value: boolean) => void;
  sessionActive: boolean;
  onEndSession: () => void;
  onRerunScenario: (scenario: Scenario) => void;
  runTimeline: RunTimelineEntry[];
  stackPaused: boolean;
  onRemoveFromStack: (seq: number) => void;
  onClearDoneRecords: () => void;
  onPauseStack: () => void;
  onResumeStack: () => void;
  previewImage: string;
  stepPreviews: Record<string, string>;
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
  onSetViewport: (width: number, height: number) => void;
  onGoToPicker: () => void;
  onCancel: () => void;
  onPopout: (viewportLabel: string) => void;
  onLivePreviewChange: (value: boolean) => void;
  runVideos: Array<{ scenario: Scenario; path: string }>;
  fullRunVideoAvailable: boolean;
  onDownloadRunVideo: (path: string) => void;
  onDownloadFullRunVideo: () => void;
  reportAvailable: boolean;
  onOpenReport: () => void;
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
  elapsedSeconds,
  livePreview,
  keepSession,
  onKeepSessionChange,
  sessionActive,
  onEndSession,
  onRerunScenario,
  runTimeline,
  stackPaused,
  onRemoveFromStack,
  onClearDoneRecords,
  onPauseStack,
  onResumeStack,
  previewImage,
  stepPreviews,
  onManualBrowserEvent,
  onCompleteManualControl,
  onFailManualControl,
  onSetViewport,
  onGoToPicker,
  onCancel,
  onPopout,
  onLivePreviewChange,
  runVideos,
  fullRunVideoAvailable,
  onDownloadRunVideo,
  onDownloadFullRunVideo,
  reportAvailable,
  onOpenReport,
}: Props) => {
  const [manualFailureReason, setManualFailureReason] = useState("");
  const [selStep, setSelStep] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<"ALL" | "ERR">("ALL");
  const [vpKey, setVpKey] = useState("2560x1440");
  const [fitMode, setFitMode] = useState<FitMode>("fit");
  const [zen, setZen] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [imgSize, setImgSize] = useState({ w: 1280, h: 720 });
  const [customScale, setCustomScale] = useState<number | null>(null);
  const [scaleDraft, setScaleDraft] = useState<string | null>(null);
  const manualImageRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const consoleBodyRef = useRef<HTMLDivElement | null>(null);
  const rqStripRef = useRef<HTMLDivElement | null>(null);
  const isConsoleAtBottomRef = useRef(true);
  const onSetViewportRef = useRef(onSetViewport);
  const viewportRequestRef = useRef<string | null>(null);
  onSetViewportRef.current = onSetViewport;

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setStageSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    observer.observe(el);
    setStageSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, [livePreview, zen]);

  useEffect(() => {
    if (!running) {
      viewportRequestRef.current = null;
      return;
    }
    if (manualControl) return;
    const preset =
      VIEWPORT_PRESETS.find((v) => v.key === vpKey) ?? VIEWPORT_PRESETS[0];
    const requestKey = `${scenario.id}:${preset.key}`;
    if (viewportRequestRef.current === requestKey) return;
    viewportRequestRef.current = requestKey;
    onSetViewportRef.current(preset.w, preset.h);
  }, [running, manualControl, vpKey, scenario.id]);

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
  const failedAny = scenarioResults.some(
    (result) => result.status === "failed",
  );
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

  const directOn = Boolean(manualControl);
  const selectedPreview = selStep ? stepPreviews[selStep] : undefined;
  const viewportImage = directOn
    ? previewImage
    : (selectedPreview ?? previewImage);
  const selectedScenario = selStep
    ? scenarios.find((item) => item.id === selStep.split(":", 1)[0])
    : undefined;
  const viewportScenario = selectedScenario ?? scenario;
  const effectiveFit: FitMode = fitMode;
  const vpPreset =
    VIEWPORT_PRESETS.find((v) => v.key === vpKey) ?? VIEWPORT_PRESETS[0];
  const vpNow = directOn
    ? {
        key: "capture",
        w: imgSize.w,
        h: imgSize.h,
        label: `${imgSize.w}×${imgSize.h}`,
        title: "실제 캡처 크기",
      }
    : vpPreset;
  const stageW = Math.max(0, stageSize.w - 24);
  const stageH = Math.max(0, stageSize.h - 24);
  let scale = 1;
  if (effectiveFit === "width") scale = stageW > 0 ? stageW / vpNow.w : 1;
  else if (effectiveFit === "fit")
    scale =
      stageW > 0 && stageH > 0
        ? Math.min(stageW / vpNow.w, (stageH - CHROME_H) / vpNow.h, 1)
        : 1;
  scale = Math.max(0.08, Math.min(scale, 2));
  if (customScale !== null) scale = customScale;
  const displayScalePercent = scaleDraft ?? String(Math.round(scale * 100));
  const commitScaleDraft = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      setCustomScale(Math.max(0.08, Math.min(parsed / 100, 2)));
    }
    setScaleDraft(null);
  };
  const pageW = Math.round(vpNow.w * scale);
  const pageH = Math.round(vpNow.h * scale);
  const needScroll =
    stageW > 0 && (pageW > stageW + 1 || pageH + CHROME_H > stageH + 1);
  const cropLabel = needScroll
    ? "스테이지보다 큼 · 스크롤로 이동"
    : scale < 0.999
      ? "축소 표시 · 잘림 없음"
      : "원본 크기 · 1:1";
  const cropFg = needScroll ? "#96690C" : scale < 0.999 ? "#8A939C" : "#1E7A4A";
  const logCollapsed = zen || directOn;

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
        ? finished.status === "passed" ||
          (failedAt !== null && index < failedAt)
        : isCurrentScenario && index < runProgress.current;
      const failed = failedAt !== null && index === failedAt;
      const isRunning =
        !finished &&
        running &&
        isCurrentScenario &&
        index === runProgress.current;
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
        targetFg: hasResult || isRunning ? "#14181C" : "#8A939C",
        pulsing: isRunning,
        cursor: stepPreviews[stepKey] ? "pointer" : "default",
        onClick: stepPreviews[stepKey] ? () => setSelStep(stepKey) : undefined,
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
    logFilter === "ALL"
      ? runLog
      : runLog.filter((line) => line.includes("실패"));

  useLayoutEffect(() => {
    const consoleBody = consoleBodyRef.current;
    if (!consoleBody) return;
    if (
      isConsoleAtBottomRef.current ||
      consoleBody.scrollHeight <= consoleBody.clientHeight
    ) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
      isConsoleAtBottomRef.current = true;
    }
  }, [runLog, logFilter]);

  const handleConsoleScroll = () => {
    const consoleBody = consoleBodyRef.current;
    if (!consoleBody) return;
    isConsoleAtBottomRef.current =
      consoleBody.scrollHeight -
        consoleBody.scrollTop -
        consoleBody.clientHeight <=
      1;
  };

  const queuedTimeline = runTimeline.filter(
    (entry) => entry.status === "queued",
  );
  const timelineVisual = (entry: RunTimelineEntry) => {
    const base = {
      dot: RQ_IDLE_DOT,
      meta: "",
      meta2: "",
      metaColor: "#8A939C",
      bg: "#FFFFFF",
      line: "#E4E7EA",
      nameColor: "#14181C",
      seqColor: "#8A939C",
    };
    if (entry.status === "passed")
      return {
        ...base,
        dot: PASS,
        meta: `통과 ${entry.totalSteps}/${entry.totalSteps}`,
        meta2: fmtElapsed(entry.elapsedSeconds ?? 0),
        metaColor: PASS,
        nameColor: "#5A646E",
      };
    if (entry.status === "failed")
      return {
        ...base,
        dot: FAIL,
        meta: `실패 ${entry.finishedStep ?? 0}단계`,
        meta2: fmtElapsed(entry.elapsedSeconds ?? 0),
        metaColor: FAIL,
        nameColor: "#5A646E",
      };
    if (entry.status === "cancelled")
      return {
        ...base,
        meta: "취소됨",
        meta2: fmtElapsed(entry.elapsedSeconds ?? 0),
        nameColor: "#5A646E",
      };
    if (entry.status === "running")
      return {
        ...base,
        dot: RQ_ACTIVE,
        meta: `${stackPaused ? "일시정지 " : "실행 중 "}${runProgress.current}/${runProgress.total}`,
        meta2: fmtElapsed(elapsedSeconds),
        metaColor: RQ_ACTIVE,
        bg: "#F5F9FE",
        line: "#B9D4F1",
        seqColor: RQ_ACTIVE,
      };
    const queuedIndex = queuedTimeline.indexOf(entry);
    return {
      ...base,
      meta: queuedIndex === 0 ? "다음 차례" : `대기 ${queuedIndex + 1}번째`,
      metaColor: RQ_QUEUED,
      seqColor: "#5A646E",
    };
  };

  useEffect(() => {
    const el = rqStripRef.current;
    if (!el) return;
    const running = el.querySelector<HTMLElement>('[data-running="true"]');
    if (!running) return;
    const target = Math.max(0, running.offsetLeft - 60);
    if (Math.abs(el.scrollLeft - target) > 4) el.scrollLeft = target;
  }, [runTimeline, runProgress.current]);

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
            <Button className="run-stop-btn" onClick={onCancel}>
              <span className="msi">stop</span>
              실행 중단
            </Button>
          )}
          {canReplay && (
            <Button variant="secondary" onClick={onGoToPicker}>
              시나리오 다시 선택
            </Button>
          )}
          {reportAvailable && !running && (
            <Button
              className="run-report-btn"
              title="실행 결과 리포트 보기 · Markdown 다운로드"
              onClick={onOpenReport}
            >
              <span className="msi">description</span>
              리포트
            </Button>
          )}
          {fullRunVideoAvailable && !running && (
            <Button
              className="run-full-video-btn"
              title="모든 시나리오를 이어 붙인 영상 (mp4)"
              onClick={onDownloadFullRunVideo}
            >
              <span className="msi">download</span>
              전체 영상
            </Button>
          )}
          <Button
            className={`run-session-btn${keepSession ? " active" : ""}`}
            title={
              running
                ? "지금 실행 중인 브라우저를 그대로 유지 세션으로 사용합니다. 다음 실행부터 재인증을 건너뜁니다."
                : "켜두면 시나리오를 다시 실행할 때 이전 실행의 로그인 세션(쿠키)을 그대로 사용해 재인증을 건너뜁니다."
            }
            aria-pressed={keepSession}
            onClick={() => onKeepSessionChange(!keepSession)}
          >
            <span className="run-session-dot" />
            세션 유지
          </Button>
          {sessionActive && (
            <Button
              variant="secondary"
              className="run-session-end-btn"
              disabled={running}
              onClick={onEndSession}
            >
              세션 종료
            </Button>
          )}
          <Popover
            label="Chromium · 1w"
            className="run-settings-menu"
            triggerClassName="run-settings-btn"
            panelClassName="run-settings-popover"
          >
            <div className="run-settings-group">
              <p>BROWSER</p>
              <div className="setting-choice">
                <Button className="selected">Chromium</Button>
                <Button>WebKit</Button>
                <Button>Firefox</Button>
              </div>
            </div>
            <div className="run-settings-group">
              <p>WORKERS</p>
              <div className="setting-choice">
                <Button className="selected">1</Button>
                <Button>2</Button>
                <Button>4</Button>
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
          </Popover>
        </div>
      </div>

      <div className="run-tape">
        {groups
          .flatMap((group) => group.steps)
          .map((row) => (
            <div
              key={row.stepKey}
              className="run-tape-bar"
              style={{ background: row.dot }}
              title={`step ${row.index + 1}`}
            />
          ))}
      </div>

      {runTimeline.length > 0 && (
        <div className="run-rq-bar">
          <div className="run-rq-head">
            <span className="run-rq-title">실행 대기열</span>
            <span className="run-rq-count">
              완료{" "}
              {
                runTimeline.filter(
                  (entry) =>
                    entry.status === "passed" || entry.status === "failed",
                ).length
              }{" "}
              · 실행{" "}
              {runTimeline.filter((entry) => entry.status === "running").length}{" "}
              · 대기 {queuedTimeline.length}
            </span>
            <div className="run-rq-actions">
              <Button variant="secondary" onClick={onClearDoneRecords}>
                완료 기록 지우기
              </Button>
              <Button
                className="run-rq-pause-btn"
                onClick={stackPaused ? onResumeStack : onPauseStack}
              >
                <span className="msi">
                  {stackPaused ? "play_arrow" : "pause"}
                </span>
                {stackPaused ? "계속" : "일시정지"}
              </Button>
            </div>
          </div>
          <div className="run-rq-strip" ref={rqStripRef}>
            {runTimeline.map((entry, index) => {
              const visual = timelineVisual(entry);
              return (
                <div className="run-rq-item" key={entry.seq}>
                  {index > 0 && (
                    <span className="msi run-rq-chevron">chevron_right</span>
                  )}
                  <div
                    className="run-rq-card"
                    data-running={entry.status === "running"}
                    title={entry.scenario.title}
                    style={{ background: visual.bg, borderColor: visual.line }}
                  >
                    <div className="run-rq-card-row">
                      <span
                        className="run-rq-seq"
                        style={{ color: visual.seqColor }}
                      >
                        #{pad2(entry.seq)}
                      </span>
                      <span
                        className="run-rq-dot"
                        style={{ background: visual.dot }}
                      />
                      <span
                        className="run-rq-name"
                        style={{ color: visual.nameColor }}
                      >
                        {entry.scenario.title}
                      </span>
                      {(entry.status === "queued" ||
                        entry.status === "running") && (
                        <button
                          type="button"
                          className="run-rq-remove"
                          aria-label={
                            entry.status === "running"
                              ? `${entry.scenario.title} 실행 취소 및 대기열에서 제거`
                              : `${entry.scenario.title} 대기열에서 제거`
                          }
                          title={
                            entry.status === "running"
                              ? "이 시나리오만 취소하고 다음 항목으로 진행"
                              : undefined
                          }
                          onClick={() => onRemoveFromStack(entry.seq)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div
                      className="run-rq-card-meta"
                      style={{ color: visual.metaColor }}
                    >
                      <span>{visual.meta}</span>
                      <span className="run-rq-meta2">{visual.meta2}</span>
                    </div>
                    {entry.status === "running" && (
                      <div
                        className="run-rq-progress"
                        style={{
                          width: `${Math.round(
                            (runProgress.current /
                              Math.max(runProgress.total, 1)) *
                              100,
                          )}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
            <Button variant="primary" onClick={onSubmitManualInput}>
              입력 완료 · 계속
            </Button>
            <Button className="run-manual-skip" onClick={onCancelManual}>
              취소
            </Button>
          </div>
        </div>
      )}

      <div className={`run-cols${zen ? " run-cols-zen" : ""}`}>
        <div className="run-execution">
          <div className="run-col-head">
            <span>EXECUTION</span>
            <span className="run-col-head-meta">
              {runProgress.current}/{runProgress.total} steps
            </span>
            {selStep && (
              <Button
                className="run-live-return"
                onClick={() => setSelStep(null)}
              >
                LIVE로 복귀
              </Button>
            )}
          </div>
          <div className="run-execution-body">
            {groups.map((group) => (
              <div key={group.scenario.id}>
                <div className="run-group-head">
                  <span
                    className="run-group-dot"
                    style={{ background: group.dot }}
                  />
                  <span>{group.scenario.title}</span>
                  <span className="run-group-count">
                    {group.scenario.steps.length}단계
                  </span>
                  {(() => {
                    const video = runVideos.find(
                      (item) => item.scenario.id === group.scenario.id,
                    );
                    return (
                      video && (
                        <Button
                          className="run-group-icon-btn"
                          title={`${group.scenario.title} 영상 다운로드 (mp4)`}
                          onClick={() => onDownloadRunVideo(video.path)}
                        >
                          <span className="msi">download</span>
                        </Button>
                      )
                    );
                  })()}
                  <Button
                    className="run-group-icon-btn run-group-rerun"
                    title="이 시나리오를 대기열 끝에 추가"
                    onClick={() => onRerunScenario(group.scenario)}
                  >
                    <span className="msi">replay</span>
                  </Button>
                </div>
                {group.steps.map((row) => (
                  <Button
                    key={row.stepKey}
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
                    <ActionTag
                      action={row.step.action}
                      className="run-step-op"
                    />
                    <span
                      className="run-step-target"
                      style={{ color: row.targetFg }}
                    >
                      {actionText(row.step)}
                    </span>
                  </Button>
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
                <Button
                  className="run-live-return"
                  onClick={() => onLivePreviewChange(false)}
                >
                  숨기기
                </Button>
              </div>

              <div className="run-viewport-toolbar">
                <div className="run-viewport-toolbar-scroll">
                  <div className="run-vp-group">
                    {VIEWPORT_PRESETS.map((preset) => (
                      <Button
                        key={preset.key}
                        title={`${preset.title} · ${preset.label}`}
                        className={
                          !directOn && vpKey === preset.key ? "active" : ""
                        }
                        disabled={directOn}
                        onClick={() => {
                          setVpKey(preset.key);
                          setCustomScale(null);
                        }}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                  <span className="run-vp-divider" />
                  <div className="run-vp-group">
                    {FIT_MODES.map((mode) => (
                      <Button
                        key={mode.key}
                        title={mode.title}
                        className={
                          customScale === null && effectiveFit === mode.key
                            ? "active"
                            : ""
                        }
                        onClick={() => {
                          setFitMode(mode.key);
                          setCustomScale(null);
                        }}
                      >
                        {mode.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="run-viewport-toolbar-right">
                  <div
                    className={`run-vp-scale${directOn ? " direct" : ""}`}
                    title="실제 브라우저 픽셀 대비 표시 배율 · 직접 입력할 수 있습니다"
                  >
                    <input
                      type="number"
                      className="run-vp-scale-input"
                      min={8}
                      max={200}
                      value={displayScalePercent}
                      onFocus={(event) => {
                        setScaleDraft(String(Math.round(scale * 100)));
                        event.currentTarget.select();
                      }}
                      onChange={(event) => setScaleDraft(event.target.value)}
                      onBlur={(event) =>
                        commitScaleDraft(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          setScaleDraft(null);
                          event.currentTarget.blur();
                        }
                      }}
                      aria-label="표시 배율 직접 입력"
                    />
                    <span>%</span>
                    <span className="run-vp-scale-note">
                      {customScale !== null
                        ? "직접 입력"
                        : effectiveFit === "actual"
                          ? "1:1"
                          : effectiveFit === "width"
                            ? "너비"
                            : "맞춘"}
                    </span>
                  </div>
                  <Button
                    className={zen ? "active" : ""}
                    onClick={() => setZen((value) => !value)}
                  >
                    {zen ? "패널 복원" : "패널 최대화"}
                  </Button>
                  <Button
                    title="실제 브라우저 창을 분리해 원본 크기로 조작"
                    onClick={() => onPopout(vpNow.label)}
                  >
                    창 분리
                  </Button>
                </div>
              </div>

              {directOn && (
                <div className="run-viewport-direct-banner">
                  <span className="run-vp-direct-dot" />
                  직접 제어 중 · 배율을 조정해도 클릭 좌표는 실제 화면 기준으로
                  자동 보정됩니다
                  <span className="run-viewport-direct-hint">
                    {vpNow.label} 세션
                  </span>
                </div>
              )}

              <div
                ref={stageRef}
                className="run-stage"
                style={{
                  overflow: needScroll ? "auto" : "hidden",
                  alignItems: needScroll ? "flex-start" : "center",
                  justifyContent: needScroll ? "flex-start" : "center",
                }}
              >
                <div
                  className="run-frame"
                  style={{
                    width: pageW,
                    height: pageH + CHROME_H,
                    borderColor: directOn ? "#C08A15" : undefined,
                  }}
                >
                  <div
                    className="run-frame-chrome"
                    style={{ height: CHROME_H }}
                  >
                    <span className="run-frame-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <div className="run-frame-url">{viewportScenario.url}</div>
                    <div className="run-frame-size">{vpNow.label}</div>
                  </div>
                  <div className="run-frame-body">
                    {viewportImage ? (
                      <img
                        ref={manualImageRef}
                        className={manualControl ? "manual-browser-screen" : ""}
                        src={viewportImage}
                        style={{
                          width: pageW,
                          height: pageH,
                          objectFit: "contain",
                        }}
                        onLoad={(event) =>
                          setImgSize({
                            w: event.currentTarget.naturalWidth || 1280,
                            h: event.currentTarget.naturalHeight || 720,
                          })
                        }
                        alt={
                          manualControl
                            ? "직접 조작할 브라우저 화면"
                            : selStep
                              ? "선택한 단계의 실행 화면"
                              : "현재 테스트 실행 화면"
                        }
                        tabIndex={manualControl ? 0 : -1}
                        onClick={
                          manualControl
                            ? (event) => {
                                const point = browserPoint(event);
                                if (point)
                                  onManualBrowserEvent({
                                    type: "click",
                                    ...point,
                                  });
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
                                const text =
                                  event.clipboardData.getData("text");
                                if (text)
                                  onManualBrowserEvent({ type: "text", text });
                              }
                            : undefined
                        }
                      />
                    ) : (
                      <div className="run-viewport-caption">
                        표시할 단계 화면이 아직 없습니다.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="run-viewport-status">
                <span>{selStep ? "선택 단계" : vpNow.label}</span>
                <span
                  className="run-viewport-status-crop"
                  style={{ color: cropFg }}
                >
                  {cropLabel}
                </span>
              </div>

              {manualControl && (
                <div className="manual-browser-actions">
                  <input
                    value={manualFailureReason}
                    onChange={(event) =>
                      setManualFailureReason(event.target.value)
                    }
                    placeholder="실패 시 사유를 입력하세요"
                  />
                  <Button
                    variant="danger"
                    disabled={!manualFailureReason.trim()}
                    onClick={() =>
                      onFailManualControl(manualFailureReason.trim())
                    }
                  >
                    실패로 기록
                  </Button>
                  <Button variant="primary" onClick={onCompleteManualControl}>
                    완료 후 계속
                  </Button>
                </div>
              )}
            </div>
          )}
          <div
            className={`run-console${logCollapsed ? " run-console-collapsed" : livePreview ? " run-console-compact" : ""}`}
          >
            <div className="run-col-head run-console-head">
              <span>CONSOLE</span>
              <div className="run-log-filters">
                {(["ALL", "ERR"] as const).map((f) => (
                  <Button
                    key={f}
                    className={logFilter === f ? "active" : ""}
                    onClick={() => setLogFilter(f)}
                  >
                    {f}
                  </Button>
                ))}
              </div>
              {!livePreview && (
                <Button
                  className="run-live-return run-live-return-dark"
                  onClick={() => onLivePreviewChange(true)}
                >
                  VIEWPORT 표시
                </Button>
              )}
            </div>
            <div
              ref={consoleBodyRef}
              className="run-console-body"
              onScroll={handleConsoleScroll}
            >
              {filteredLog.length ? (
                filteredLog.map((log, index) => (
                  <div
                    className="run-log-line"
                    key={index}
                    style={{ color: logLineColor(log) }}
                  >
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
