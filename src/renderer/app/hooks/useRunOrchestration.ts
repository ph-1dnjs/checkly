import { useEffect, useRef, useState } from "react";
import {
  emptyScenario,
  type Route,
  type RunProgress,
  type RunRecord,
  type RunSummary,
  type Scenario,
  type ScenarioRunResult,
  type Step,
} from "../../shared/model/scenario";

export type RunNotification = {
  total: number;
  currentScenario: number;
  scenarioTitle: string;
  status: "running" | "passed" | "failed" | "cancelled";
  passed: number;
  failed: number;
};

type UseRunOrchestrationOptions = {
  showToast: (message: string) => void;
  setRoute: (route: Route) => void;
};

export const useRunOrchestration = ({
  showToast,
  setRoute,
}: UseRunOrchestrationOptions) => {
  const [manual, setManual] = useState<Step | null>(null);
  const [manualControl, setManualControl] = useState<
    (Step & { timeoutSeconds?: number }) | null
  >(null);
  const [manualValue, setManualValue] = useState("");
  const [manualValueVisible, setManualValueVisible] = useState(false);
  const [manualResult, setManualResult] = useState<
    (Step & { timeoutSeconds?: number }) | null
  >(null);
  const [manualFailureReason, setManualFailureReason] = useState("");
  const [running, setRunning] = useState(false);
  const [runningScenario, setRunningScenario] = useState(emptyScenario);
  const [runLog, setRunLog] = useState<string[]>([]);
  const [runProgress, setRunProgress] = useState<RunProgress>({
    current: 0,
    total: emptyScenario.steps.length,
    step: "",
  });
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [livePreview, setLivePreview] = useState(true);
  const [previewImage, setPreviewImage] = useState("");
  const [stepPreviews, setStepPreviews] = useState<Record<string, string>>({});
  const [runVideos, setRunVideos] = useState<
    Array<{ scenario: Scenario; path: string }>
  >([]);
  const [fullRunVideoPath, setFullRunVideoPath] = useState<string | null>(null);
  const [runNotification, setRunNotification] =
    useState<RunNotification | null>(null);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummary>({
    total: 0,
    passed: 0,
    failed: 0,
  });
  const [liveResults, setLiveResults] = useState<ScenarioRunResult[]>([]);
  const [openRunRecord, setOpenRunRecord] = useState<RunRecord | null>(null);
  const [runQueue, setRunQueue] = useState<Scenario[]>([]);
  const [runValidationError, setRunValidationError] = useState<string | null>(
    null,
  );
  const runCancelled = useRef(false);
  const runSequence = useRef(0);
  const runVideoPaths = useRef<string[]>([]);
  const runVideoScenario = useRef<Scenario | null>(null);
  const runProgressRef = useRef<RunProgress>(runProgress);

  useEffect(
    () =>
      window.electronAPI.onManualInputRequired((step) => {
        setManual(step);
        setRunLog((logs) => [
          ...logs,
          `단계 ${step.id}: ${step.target} 수동 입력 대기`,
        ]);
      }),
    [],
  );

  useEffect(
    () =>
      window.electronAPI.onManualControlRequired((step) => {
        setManualControl(step);
        setRunLog((logs) => [
          ...logs,
          `단계 ${step.id}: ${step.target} 브라우저 직접 제어 대기 (최대 5분)`,
        ]);
      }),
    [],
  );

  useEffect(
    () =>
      window.electronAPI.onManualResultRequired((step) => {
        setManualFailureReason("");
        setManualResult(step);
        setRunLog((logs) => [
          ...logs,
          `단계 ${step.id}: ${step.target} 수동 결과 확인 대기 (최대 5분)`,
        ]);
      }),
    [],
  );

  useEffect(
    () =>
      window.electronAPI.onQaProgress((progress) => {
        runProgressRef.current = progress;
        setRunProgress(progress);
        setRunLog((logs) => [
          ...logs,
          `${progress.current}/${progress.total} ${progress.step}`,
        ]);
      }),
    [],
  );

  useEffect(() => window.electronAPI.onQaPreview(setPreviewImage), []);

  useEffect(
    () =>
      window.electronAPI.onQaStepPreview(({ scenarioId, stepId, image }) => {
        setStepPreviews((previews) => ({
          ...previews,
          [`${scenarioId}:${stepId}`]: image,
        }));
      }),
    [],
  );

  useEffect(
    () =>
      window.electronAPI.onRunVideo((filePath) => {
        if (!filePath || !runVideoScenario.current) return;
        runVideoPaths.current.push(filePath);
        setRunVideos((videos) => [
          ...videos,
          { scenario: runVideoScenario.current!, path: filePath },
        ]);
      }),
    [],
  );

  useEffect(() => {
    if (!running || !runStartedAt) return;
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - runStartedAt) / 1000)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [running, runStartedAt]);

  const runProgressPercent = runProgress.total
    ? Math.round((runProgress.current / runProgress.total) * 100)
    : 0;
  const scenarioProgressPercent = runNotification
    ? Math.round(
        ((runNotification.currentScenario - 1 + runProgressPercent / 100) /
          runNotification.total) *
          100,
      )
    : 0;

  const recordRun = (
    completed: Scenario[],
    passed: number,
    failed: number,
    results: ScenarioRunResult[],
  ) =>
    setRunHistory((history) => {
      const status: "passed" | "failed" = failed ? "failed" : "passed";
      const nextHistory = [
        {
          id: `${Date.now()}`,
          scenarios: completed,
          status,
          passed,
          failed,
          ranAt: new Date().toISOString(),
          results,
        },
        ...history,
      ].slice(0, 5);
      setRunSummary((summary) => ({
        total: summary.total + 1,
        passed: summary.passed + Number(status === "passed"),
        failed: summary.failed + Number(status === "failed"),
      }));
      return nextHistory;
    });

  const beginRuns = (scenarios: Scenario[], background = false) => {
    if (!scenarios.length) {
      setRunValidationError(
        "실행할 시나리오가 없습니다. 편집기에서 시나리오를 작성하거나 시나리오 선택 화면에서 파일을 불러와 주세요.",
      );
      return;
    }
    const toRun = scenarios;
    const includesManualControl = toRun.some((item) =>
      item.steps.some((step) => step.action === "manualControl"),
    );
    const sequence = ++runSequence.current;
    if (!background) setRoute("run");
    setRunning(true);
    runCancelled.current = false;
    setRunQueue(toRun);
    setRunningScenario(toRun[0]);
    setRunStartedAt(Date.now());
    setElapsedSeconds(0);
    setPreviewImage("");
    setStepPreviews({});
    setRunVideos([]);
    setFullRunVideoPath(null);
    runVideoPaths.current = [];
    runVideoScenario.current = null;
    setLiveResults([]);
    runProgressRef.current = {
      current: 0,
      total: toRun[0].steps.length,
      step: "",
    };
    setRunProgress(runProgressRef.current);
    setRunLog([
      `${toRun.length}개 시나리오 실행을 시작했습니다.`,
      ...(includesManualControl
        ? [
            "브라우저 직접 제어 단계에서는 실행 화면에서 같은 브라우저 세션을 조작할 수 있습니다.",
          ]
        : []),
    ]);
    setRunNotification({
      total: toRun.length,
      currentScenario: 1,
      scenarioTitle: toRun[0].title,
      status: "running",
      passed: 0,
      failed: 0,
    });
    void (async () => {
      let passed = 0;
      let failed = 0;
      let cancelled = false;
      const collected: ScenarioRunResult[] = [];
      for (const [index, runScenario] of toRun.entries()) {
        if (runCancelled.current || sequence !== runSequence.current) {
          cancelled = true;
          break;
        }
        setRunningScenario(runScenario);
        setRunStartedAt(Date.now());
        setElapsedSeconds(0);
        runProgressRef.current = {
          current: 0,
          total: runScenario.steps.length,
          step: "",
        };
        setRunProgress(runProgressRef.current);
        setRunLog((logs) => [
          ...logs,
          `[${index + 1}/${toRun.length}] ${runScenario.title} 실행 시작`,
        ]);
        setRunNotification(
          (notification) =>
            notification && {
              ...notification,
              currentScenario: index + 1,
              scenarioTitle: runScenario.title,
            },
        );
        try {
          runVideoScenario.current = runScenario;
          const result = await window.electronAPI.runQa(runScenario, {
            preview: livePreview,
            workerId: String(sequence),
          });
          if (sequence !== runSequence.current) break;
          setRunLog((logs) => [
            ...logs,
            ...result.log,
            `[${index + 1}/${toRun.length}] ${runScenario.title} ${result.status === "passed" ? "통과" : result.status === "cancelled" ? "취소" : "실패"}`,
          ]);
          if (result.status === "passed" || result.status === "failed") {
            passed += Number(result.status === "passed");
            failed += Number(result.status === "failed");
            const entry: ScenarioRunResult = {
              scenario: runScenario,
              status: result.status,
              failedStepIndex:
                result.status === "failed"
                  ? runProgressRef.current.current
                  : undefined,
              message:
                result.status === "failed"
                  ? result.log[result.log.length - 1]
                  : undefined,
            };
            collected.push(entry);
            setLiveResults((r) => [...r, entry]);
          }
          if (result.status === "cancelled") {
            const entry: ScenarioRunResult = {
              scenario: runScenario,
              status: "cancelled",
            };
            collected.push(entry);
            setLiveResults((r) => [...r, entry]);
            cancelled = true;
            break;
          }
        } catch (error) {
          failed += 1;
          const entry: ScenarioRunResult = {
            scenario: runScenario,
            status: "failed",
            failedStepIndex: runProgressRef.current.current,
            message: error instanceof Error ? error.message : String(error),
          };
          collected.push(entry);
          setLiveResults((r) => [...r, entry]);
          setRunLog((logs) => [
            ...logs,
            `[${index + 1}/${toRun.length}] ${runScenario.title} 실행 실패`,
          ]);
        }
      }
      await window.electronAPI.finishQaWorker(String(sequence));
      if (sequence === runSequence.current) {
        if (!cancelled) {
          recordRun(toRun, passed, failed, collected);
          try {
            const videoPath = await window.electronAPI.mergeRunVideos(
              runVideoPaths.current,
            );
            setFullRunVideoPath(videoPath);
          } catch {
            showToast("전체 시나리오 영상을 만들지 못했습니다.");
          }
        }
        setRunning(false);
        setRunNotification(
          (notification) =>
            notification && {
              ...notification,
              status: cancelled ? "cancelled" : failed ? "failed" : "passed",
              passed,
              failed,
            },
        );
      }
    })();
  };

  const cancelRuns = () => {
    runCancelled.current = true;
    runSequence.current += 1;
    void window.electronAPI.cancelQa();
    setRunning(false);
    setRunNotification(
      (notification) =>
        notification && {
          ...notification,
          status: "cancelled",
        },
    );
  };

  const popoutViewport = (viewportLabel: string) => {
    setRunLog((logs) => [
      ...logs,
      `[VIEW] browser window detached · ${viewportLabel} @100%`,
    ]);
    showToast(`브라우저 창 분리 · ${viewportLabel} 원본 크기`);
  };

  const submitManualInput = () => {
    void window.electronAPI.submitManualInput(manualValue);
    setManual(null);
    setManualValue("");
  };
  const cancelManual = () => void window.electronAPI.cancelQa();
  const completeManualControl = () => {
    void window.electronAPI.submitManualControl({ status: "continue" });
    setManualControl(null);
  };
  const failManualControl = (reason: string) => {
    void window.electronAPI.submitManualControl({ status: "failed", reason });
    setManualControl(null);
  };
  const passManualResult = () => {
    void window.electronAPI.submitManualResult({ status: "passed" });
    setManualResult(null);
  };
  const failManualResult = () => {
    void window.electronAPI.submitManualResult({
      status: "failed",
      reason: manualFailureReason.trim(),
    });
    setManualResult(null);
  };
  const downloadRunVideo = (videoPath: string | null) => {
    if (!videoPath) return;
    void window.electronAPI
      .downloadRunVideo(videoPath)
      .then((filePath) => {
        if (filePath) showToast("실행 영상을 다운로드했습니다.");
      })
      .catch(() => showToast("실행 영상을 다운로드하지 못했습니다."));
  };
  const downloadFullRunVideo = () => {
    if (!fullRunVideoPath) return;
    void window.electronAPI
      .downloadRunVideo(fullRunVideoPath)
      .then((filePath) => {
        if (filePath) showToast("전체 시나리오 영상을 다운로드했습니다.");
      })
      .catch(() => showToast("전체 시나리오 영상을 다운로드하지 못했습니다."));
  };

  return {
    manual,
    setManual,
    manualControl,
    setManualControl,
    manualValue,
    setManualValue,
    manualValueVisible,
    setManualValueVisible,
    manualResult,
    setManualResult,
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
  };
};

export type UseRunOrchestrationResult = ReturnType<typeof useRunOrchestration>;
