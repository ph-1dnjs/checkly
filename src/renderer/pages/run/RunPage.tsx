import {
  actionText,
  estimateDurationSeconds,
  formatDuration,
  type RunProgress,
  type Scenario,
  type Step,
} from "../../shared/model/scenario";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";

type Props = {
  scenario: Scenario;
  scenarios: Scenario[];
  scenarioCount: number;
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
  onManualBrowserEvent: (event: { type: "click" | "wheel" | "key" | "text"; x?: number; y?: number; deltaY?: number; key?: string; text?: string }) => void;
  onCompleteManualControl: () => void;
  onFailManualControl: (reason: string) => void;
  onRun: () => void;
  onImport: () => void;
  onCancel: () => void;
  onLivePreviewChange: (value: boolean) => void;
  runVideoAvailable: boolean;
  onDownloadRunVideo: () => void;
};

export const RunPage = ({
  scenario,
  scenarios,
  scenarioCount,
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
  runVideoAvailable,
  onDownloadRunVideo,
}: Props) => {
  const [previewIndex, setPreviewIndex] = useState(0);
  const [manualFailureReason, setManualFailureReason] = useState("");
  const manualImageRef = useRef<HTMLImageElement | null>(null);
  const previewScenario = scenarios[previewIndex] ?? scenario;

  useEffect(() => {
    setPreviewIndex((index) => Math.min(index, Math.max(0, scenarios.length - 1)));
  }, [scenarios.length]);

  useEffect(() => {
    if (!running) return;
    const index = scenarios.findIndex((item) => item.id === scenario.id);
    if (index >= 0) setPreviewIndex(index);
  }, [running, scenario.id, scenarios]);

  useEffect(() => {
    setManualFailureReason("");
  }, [manualControl?.id]);

  const estimatedSeconds = estimateDurationSeconds(scenario);
  const browserPoint = (event: MouseEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>) => {
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
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
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
  const estimatedCompletion = runStartedAt
    ? new Date(runStartedAt + estimatedSeconds * 1000).toLocaleTimeString(
        "ko-KR",
        { hour: "2-digit", minute: "2-digit" },
      )
    : null;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">RUN CONSOLE</p>
          <h1>QA 실행</h1>
          <p>
            {running
              ? "브라우저 상태를 유지하며 실행 중입니다."
              : "실행할 시나리오를 선택하세요."}
          </p>
        </div>
        {running ? (
          <button className="button danger" onClick={onCancel}>
            실행 취소
          </button>
        ) : (
          <div className="run-header-actions">
            <button className="button button-secondary" onClick={onImport}>
              시나리오 불러오기
            </button>
            <button className="button button-primary" onClick={onRun}>
              ▶ 실행 시작
            </button>
          </div>
        )}
      </div>
      <div className="run-layout">
        <section className="run-main">
          <div className="run-state">
            <span className={running ? "pulse" : "check"}>
              {running ? "◌" : "✓"}
            </span>
            <div>
              <strong>
                {manual || manualControl || manualResult
                  ? manualControl ? "브라우저 직접 제어 대기 중" : manualResult ? "수동 결과 확인 대기 중" : "수동 입력 대기 중"
                  : running
                    ? "시나리오 실행 중"
                    : "실행 준비됨"}
              </strong>
              <p>
                {manual || manualControl || manualResult
                  ? manualControl ? `${manualControl.target} 조작을 기다리고 있습니다. (최대 5분)` : manualResult ? `${manualResult.target} 결과를 기다리고 있습니다. (최대 5분)` : `${manual!.target} 값을 기다리고 있습니다.`
                  : `${scenarioCount}개 시나리오 · ${scenario.steps.length}개 단계`}
              </p>
            </div>
            {runVideoAvailable && !running && (
              <button
                className="button button-secondary run-video-download"
                onClick={onDownloadRunVideo}
              >
                영상 다운로드
              </button>
            )}
          </div>
          <section
            className="run-scenario-preview"
            aria-label="실행 시나리오 미리보기"
          >
            <div className="run-preview-heading">
              <div>
                <strong>{previewScenario.title}</strong>
                <span>{previewScenario.url}</span>
              </div>
              {scenarios.length > 1 && (
                <div className="run-preview-navigation" aria-label="시나리오 미리보기 이동">
                  <button
                    onClick={() => setPreviewIndex((index) => index - 1)}
                    disabled={previewIndex === 0}
                    aria-label="이전 시나리오"
                  >
                    ‹
                  </button>
                  <span>{previewIndex + 1} / {scenarios.length}</span>
                  <button
                    onClick={() => setPreviewIndex((index) => index + 1)}
                    disabled={previewIndex === scenarios.length - 1}
                    aria-label="다음 시나리오"
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
            <ol>
              {previewScenario.steps.map((step) => (
                <li
                  key={step.id}
                  className={
                    running &&
                    previewScenario.id === scenario.id &&
                    step.id === String(runProgress.current)
                      ? "current"
                      : ""
                  }
                >
                  <b>{step.id}</b>
                  {actionText(step)}
                </li>
              ))}
            </ol>
          </section>
          <div className="run-timing">
            <span>
              진행 {runProgress.current}/{runProgress.total} · {progressPercent}
              %
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
          {(livePreview || manualControl) && (
            <section className="live-preview" aria-label="실시간 테스트 화면">
              <div>
                <strong>{manualControl ? "브라우저 직접 제어" : "실시간 테스트 화면"}</strong>
                <span>
                  {manualControl ? manualControl.prompt || `${manualControl.target}에서 필요한 절차를 완료해 주세요.` : "단계마다 캡처되어 실행 속도가 다소 느려질 수 있습니다."}
                </span>
              </div>
              {previewImage ? (
                <img
                  ref={manualImageRef}
                  className={manualControl ? "manual-browser-screen" : ""}
                  src={previewImage}
                  alt={manualControl ? "직접 조작할 브라우저 화면" : "현재 테스트 실행 화면"}
                  tabIndex={manualControl ? 0 : -1}
                  onClick={manualControl ? (event) => {
                    const point = browserPoint(event);
                    if (point) onManualBrowserEvent({ type: "click", ...point });
                    event.currentTarget.focus();
                  } : undefined}
                  onWheel={manualControl ? (event) => {
                    event.preventDefault();
                    const point = browserPoint(event);
                    if (point) onManualBrowserEvent({ type: "wheel", deltaY: event.deltaY, ...point });
                  } : undefined}
                  onKeyDown={manualControl ? handleManualKey : undefined}
                  onPaste={manualControl ? (event: ClipboardEvent<HTMLImageElement>) => {
                    event.preventDefault();
                    const text = event.clipboardData.getData("text");
                    if (text) onManualBrowserEvent({ type: "text", text });
                  } : undefined}
                />
              ) : (
                <p>첫 실행 화면을 기다리고 있습니다.</p>
              )}
              {manualControl && (
                <div className="manual-browser-actions">
                  <input value={manualFailureReason} onChange={(event) => setManualFailureReason(event.target.value)} placeholder="실패 시 사유를 입력하세요" />
                  <button className="button danger" disabled={!manualFailureReason.trim()} onClick={() => onFailManualControl(manualFailureReason.trim())}>실패로 기록</button>
                  <button className="button button-primary" onClick={onCompleteManualControl}>완료 후 계속</button>
                </div>
              )}
            </section>
          )}
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
        <aside className="run-side">
          <h2>실행 설정</h2>
          <label>
            브라우저
            <select>
              <option>Chromium</option>
              <option>Firefox</option>
            </select>
          </label>
          <label>
            워커 수
            <select>
              <option>1</option>
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={livePreview}
              onChange={(event) => onLivePreviewChange(event.target.checked)}
              disabled={running}
            />{" "}
            실시간 테스트 화면 보기
          </label>
          <p className="run-setting-help">
            화면을 캡처해 보여주므로 실행 시간이 조금 늘어날 수 있습니다. 끄면
            백그라운드에서 더 빠르게 실행합니다.
          </p>
          <label className="toggle">
            <input type="checkbox" /> 실패 즉시 중단
          </label>
        </aside>
      </div>
    </>
  );
};
