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

import { Input } from "../../shared/ui/Input";
const ACCENT = "#1F63AE";
const LIVE = "#3D8CE0";
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
    label: "맞춤",
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
  onCancel: () => void;
  onPopout: (viewportLabel: string) => void;
  onLivePreviewChange: (value: boolean) => void;
  runVideos: Array<{ scenario: Scenario; path: string }>;
  fullRunVideoAvailable: boolean;
  onDownloadRunVideo: (path: string) => void;
  onDownloadFullRunVideo: () => void;
  reportAvailable: boolean;
  onOpenReport: () => void;
  onGoPick: () => void;
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
  onCancel,
  onPopout,
  onLivePreviewChange,
  runVideos,
  fullRunVideoAvailable,
  onDownloadRunVideo,
  onDownloadFullRunVideo,
  reportAvailable,
  onOpenReport,
  onGoPick,
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
  // 큐가 끝나면 진행률이 초기화되므로, 끝난 실행은 결과 목록으로 완료 여부를 판단한다.
  const resultsDone = !running && scenarioResults.length > 0;
  const runComplete =
    resultsDone ||
    (!running &&
      runProgress.total > 0 &&
      runProgress.current >= runProgress.total);
  const lastResult = scenarioResults[scenarioResults.length - 1];
  const doneSteps = scenarioResults.reduce((total, result) => total + result.scenario.steps.length, 0);
  const shownProgress = resultsDone
    ? { current: doneSteps, total: doneSteps }
    : runProgress;
  const shownPercent = resultsDone ? 100 : progressPercent;
  const awaiting = Boolean(manual || manualControl || manualResult);
  const idle =
    !running &&
    !awaiting &&
    runTimeline.length === 0 &&
    scenarioResults.length === 0 &&
    runProgress.total === 0;
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
          : scenarioResults.some((result) => result.status === "cancelled")
            ? "STOPPED"
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
            : stateWord === "STOPPED"
              ? FAIL
              : IDLE;
  const canStop = running;
  const headTitle = running || !lastResult ? scenario.title : lastResult.scenario.title;

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
  const logCollapsed = zen || directOn;

  const currentStep = scenario.steps[runProgress.current];
  const nowAction = running && currentStep
    ? actionText(currentStep)
    : runComplete
      ? `완료 · 통과 ${scenarioResults.filter((result) => result.status === "passed").length}/${scenarioResults.length}`
      : "대기 중";

  const groups = scenarios.map((item) => {
    const finished = scenarioResults.find(
      (result) => result.scenario.id === item.id,
    );
    const isCurrentScenario = item.id === scenario.id;
    const steps = item.steps.map((step, index) => {
      const failedAt =
        finished?.status === "failed" ? (finished.failedStepIndex ?? 0) : null;
      const outcome = finished?.stepResults?.find(result => result.stepNo === index + 1)?.status;
      const passed = outcome ? outcome === "passed" : finished
        ? finished.status === "passed" ||
          (failedAt !== null && index < failedAt)
        : isCurrentScenario && index < runProgress.current;
      const failed = outcome ? outcome === "failed" : failedAt !== null && index === failedAt;
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
                ? LIVE
                : "#D3D8DD",
        bar: selected
          ? INK
          : failed
            ? FAIL
            : isWaiting
              ? WAIT
              : isRunning
                ? LIVE
                : "transparent",
        rowBg: selected
          ? "#F0F3F5"
          : isWaiting
            ? "#FDFBF6"
            : isRunning
              ? "#F5F9FE"
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
        : finished.status === "passed" ? "pass" : "pend"
      : isCurrentScenario && running
        ? "run"
        : "pend";
    const doneSteps = steps.filter((row) => row.dot === PASS || row.dot === FAIL).length;
    return {
      scenario: item,
      steps,
      meta:
        groupState === "pass"
          ? "PASS"
          : groupState === "fail"
            ? "FAIL"
            : `${doneSteps}/${item.steps.length}`,
      metaColor:
        groupState === "pass" ? PASS : groupState === "fail" ? FAIL : groupState === "run" ? RQ_ACTIVE : "#8A939C",
      pulsing: groupState === "run",
      dot:
        groupState === "fail"
          ? FAIL
          : groupState === "run"
            ? LIVE
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
        meta: "PASS",
        meta2: fmtElapsed(entry.elapsedSeconds ?? 0),
        metaColor: PASS,
        nameColor: "#5A646E",
      };
    if (entry.status === "failed")
      return {
        ...base,
        dot: FAIL,
        meta: `FAIL · ${entry.finishedStep ?? 0}단계`,
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
        meta: `${stackPaused ? "일시정지 " : ""}${runProgress.current}/${runProgress.total}`,
        meta2: fmtElapsed(elapsedSeconds),
        metaColor: RQ_ACTIVE,
        bg: "#F5F9FE",
        line: "#B9D4F1",
        seqColor: RQ_ACTIVE,
      };
    const queuedIndex = queuedTimeline.indexOf(entry);
    return {
      ...base,
      meta: stackPaused ? "일시정지" : queuedIndex === 0 ? "다음 차례" : `대기 ${queuedIndex + 1}번째`,
      metaColor: stackPaused ? RQ_QUEUED : "#8A939C",
      nameColor: "#5A646E",
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
          <span className={`run-state-dot${running && !awaiting ? " pulsing" : ""}`} style={{ background: stateColor }} />
          <span style={{ color: stateColor }}>{stateWord}</span>
        </div>
        <div className="run-now-scenario" title={idle ? undefined : headTitle}>{idle ? "대기 중" : headTitle}</div>
        <div className="run-now-action" title={idle ? undefined : nowAction}>{idle ? "" : running ? `${runProgress.current + 1}단계 · ${nowAction}` : nowAction}</div>
        <div className="run-progress-readout">
          <span className="run-progress-pct" style={{ color: stateColor }}>
            {shownPercent}%
          </span>
          <span className="run-progress-steps">
            {shownProgress.current}/{shownProgress.total}
          </span>
        </div>
        {canStop && (
          <Button variant="danger" className="run-stop-btn" onClick={onCancel}>
            <span className="msi" aria-hidden="true">stop</span>
            실행 중단
          </Button>
        )}
        {reportAvailable && !running && (
          <Button variant="secondary"
            className="run-report-btn"
            title="실행 결과 리포트 보기 · Markdown 다운로드"
            onClick={onOpenReport}
          >
            <span className="msi" aria-hidden="true">description</span>
            리포트
          </Button>
        )}
        {fullRunVideoAvailable && !running && (
          <Button variant="secondary"
            className="run-full-video-btn"
            title="전체 시나리오 영상 (mp4)"
            onClick={onDownloadFullRunVideo}
          >
            <span className="msi" aria-hidden="true">download</span>
            전체 영상
          </Button>
        )}
      </div>

      <div className="run-tape">
        {idle && Array.from({ length: 21 }, (_, index) => <div key={index} className="run-tape-bar" />)}
        {!idle && groups
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

      {runTimeline.length > 0 ? (
        <div className="run-rq-bar">
          <span
            className="run-rq-title"
            title={`완료 ${runTimeline.filter((entry) => entry.status === "passed" || entry.status === "failed").length} · 실행 ${runTimeline.filter((entry) => entry.status === "running").length} · 대기 ${queuedTimeline.length}`}
          >
            대기열
          </span>
          <div className="run-rq-strip" ref={rqStripRef}>
            {runTimeline.map((entry) => {
              const visual = timelineVisual(entry);
              return (
                <div
                  className="run-rq-card"
                  key={entry.seq}
                  data-running={entry.status === "running"}
                  title={`${entry.scenario.title}${visual.meta2 ? ` · ${visual.meta2}` : ""}`}
                  style={{ borderColor: visual.line }}
                >
                  <span className="run-rq-seq" style={{ color: visual.seqColor }}>
                    #{pad2(entry.seq)}
                  </span>
                  <span
                    className={`run-rq-dot${entry.status === "running" ? " pulsing" : ""}`}
                    style={{ background: visual.dot }}
                  />
                  <span className="run-rq-name" style={{ color: visual.nameColor }}>
                    {entry.scenario.title}
                  </span>
                  <span className="run-rq-meta" style={{ color: visual.metaColor }}>
                    {visual.meta}
                  </span>
                  {(entry.status === "queued" || entry.status === "running") && (
                    <Button
                      className="run-rq-remove"
                      aria-label={
                        entry.status === "running"
                          ? `${entry.scenario.title} 실행 취소 및 대기열에서 제거`
                          : `${entry.scenario.title} 대기열에서 제거`
                      }
                      title={
                        entry.status === "running"
                          ? "이 시나리오만 취소하고 다음 항목으로 진행"
                          : "대기열에서 빼기"
                      }
                      onClick={() => onRemoveFromStack(entry.seq)}
                    >
                      <span className="msi" aria-hidden="true">close</span>
                    </Button>
                  )}
                  {entry.status === "running" && (
                    <span
                      className="run-rq-progress"
                      style={{
                        width: `${Math.round(
                          (runProgress.current / Math.max(runProgress.total, 1)) * 100,
                        )}%`,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <Button
            className="run-rq-icon"
            title="완료 기록 지우기"
            aria-label="완료 기록 지우기"
            onClick={onClearDoneRecords}
          >
            <span className="msi" aria-hidden="true">clear_all</span>
          </Button>
          <Button
            className="run-rq-pause-btn"
            title={`다음 항목 자동 시작 ${stackPaused ? "재개" : "일시정지"}`}
            onClick={stackPaused ? onResumeStack : onPauseStack}
          >
            <span className="msi" aria-hidden="true">{stackPaused ? "play_arrow" : "pause"}</span>
            {stackPaused ? "재개" : "일시정지"}
          </Button>
        </div>
      ) : (
        <div className="run-rq-rule" />
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
            <Input mono
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
            <Button variant="ghost" className="run-manual-skip" onClick={onCancelManual}>
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
              {shownProgress.current}/{shownProgress.total} steps
            </span>
          </div>
          <div className="run-execution-body" data-ck-scroll="light">
            {idle && (
              <div className="run-idle">
                <span className="msi" aria-hidden="true">playlist_play</span>
                <p>실행 중인 시나리오가 없습니다.</p>
                <Button variant="secondary" onClick={onGoPick}>
                  대상 선택
                  <span className="msi" aria-hidden="true">arrow_forward</span>
                </Button>
              </div>
            )}
            {!idle && groups.map((group) => {
              const video = runVideos.find((item) => item.scenario.id === group.scenario.id);
              return (
              <div key={group.scenario.id}>
                <div className="run-group-head">
                  <span
                    className={`run-group-dot${group.pulsing ? " pulsing" : ""}`}
                    style={{ background: group.dot }}
                  />
                  <span className="run-group-title" title={group.scenario.title}>{group.scenario.title}</span>
                  <span className="run-group-count" style={{ color: group.metaColor }}>
                    {group.meta}
                  </span>
                  {video && (
                    <Button
                      className="run-group-icon-btn"
                      title={`${group.scenario.title} 영상 다운로드 (mp4)`}
                      aria-label={`${group.scenario.title} 영상 다운로드`}
                      onClick={() => onDownloadRunVideo(video.path)}
                    >
                      <span className="msi" aria-hidden="true">download</span>
                    </Button>
                  )}
                  <Button
                    className="run-group-icon-btn run-group-rerun"
                    title="다시 실행 · 대기열에 추가"
                    aria-label={`${group.scenario.title} 다시 실행`}
                    onClick={() => onRerunScenario(group.scenario)}
                  >
                    <span className="msi" aria-hidden="true">replay</span>
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
              );
            })}
          </div>
        </div>

        <div className="run-side">
          {livePreview && (
            <div className="run-viewport">
              <div className="run-viewport-toolbar">
                <span className="run-vp-label">VIEWPORT</span>
                <div className="run-viewport-toolbar-scroll">
                  <div className="run-vp-group" role="group" aria-label="실행 해상도">
                    {VIEWPORT_PRESETS.map((preset) => (
                      <Button
                        key={preset.key}
                        title={`${preset.title} · ${preset.label}`}
                        className={
                          !directOn && vpKey === preset.key ? "active" : ""
                        }
                        aria-pressed={!directOn && vpKey === preset.key}
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
                  <div className="run-vp-group" role="group" aria-label="표시 배율">
                    {FIT_MODES.map((mode) => (
                      <Button
                        key={mode.key}
                        title={mode.title}
                        className={
                          customScale === null && effectiveFit === mode.key
                            ? "active"
                            : ""
                        }
                        aria-pressed={customScale === null && effectiveFit === mode.key}
                        onClick={() => {
                          setFitMode(mode.key);
                          setCustomScale(null);
                        }}
                      >
                        {mode.label}
                      </Button>
                    ))}
                  </div>
                  <div
                    className={`run-vp-scale${directOn ? " direct" : ""}`}
                    title={`실제 브라우저 픽셀 대비 표시 배율 · 직접 입력할 수 있습니다 · ${cropLabel}`}
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
                  </div>
                </div>
                {selStep && (
                  <Button className="run-live-return" onClick={() => setSelStep(null)}>
                    LIVE로 복귀
                  </Button>
                )}
                <span className="run-vp-cap" style={{ color: running && !selStep ? RQ_ACTIVE : "#8A939C" }}>
                  {selStep
                    ? "REPLAY"
                    : awaiting
                      ? "PAUSED"
                      : running
                        ? "CAPTURING"
                        : idle
                          ? "IDLE"
                          : "LAST FRAME"}
                </span>
                <Button
                  className="run-vp-icon"
                  title="실제 브라우저 창을 분리해 원본 크기로 조작"
                  aria-label="창 분리"
                  onClick={() => onPopout(vpNow.label)}
                >
                  <span className="msi" aria-hidden="true">open_in_new</span>
                </Button>
                <Button
                  className={`run-vp-icon${zen ? " active" : ""}`}
                  title={zen ? "패널 복원" : "패널 최대화"}
                  aria-label={zen ? "패널 복원" : "패널 최대화"}
                  aria-pressed={zen}
                  onClick={() => setZen((value) => !value)}
                >
                  <span className="msi" aria-hidden="true">{zen ? "close_fullscreen" : "open_in_full"}</span>
                </Button>
                <Button
                  className="run-vp-icon"
                  title="뷰포트 숨기기"
                  aria-label="뷰포트 숨기기"
                  onClick={() => onLivePreviewChange(false)}
                >
                  <span className="msi" aria-hidden="true">visibility_off</span>
                </Button>
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

              {manualControl && (
                <div className="manual-browser-actions">
                  <Input
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
                  className="run-console-viewport"
                  title="뷰포트 보이기"
                  aria-label="뷰포트 보이기"
                  onClick={() => onLivePreviewChange(true)}
                >
                  <span className="msi" aria-hidden="true">visibility</span>
                </Button>
              )}
            </div>
            <div
              ref={consoleBodyRef}
              className="run-console-body"
              data-ck-scroll="dark"
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
