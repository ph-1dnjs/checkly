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

const SESSION_PROMPT_STORAGE_KEY = "checkly:keepSessionPromptAnswered";

const readSessionPromptDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(SESSION_PROMPT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
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
  const [keepSession, setKeepSession] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionPromptDismissed, setSessionPromptDismissed] = useState(
    readSessionPromptDismissed,
  );
  const [sessionPromptPending, setSessionPromptPending] = useState<{
    scenarios: Scenario[];
    background: boolean;
  } | null>(null);
  const [rerunStack, setRerunStack] = useState<
    Array<{ id: string; scenario: Scenario }>
  >([]);
  const [stackPaused, setStackPaused] = useState(false);
  const runCancelled = useRef(false);
  const runSequence = useRef(0);
  const rerunStackRef = useRef<Array<{ id: string; scenario: Scenario }>>([]);
  const stackPausedRef = useRef(false);
  const sessionWorkerId = useRef<string | null>(null);
  const keepSessionRef = useRef(false);
  // 현재 진행 중인 실행이 사용하는 workerId. 실행 도중 세션 유지를 켜면
  // 이 값을 그대로 sessionWorkerId로 승격시켜, 처음부터 다시 로그인하지 않아도 되게 한다.
  const activeWorkerId = useRef<string | null>(null);
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

  const startRun = (scenarios: Scenario[], background = false) => {
    const toRun = scenarios;
    const includesManualControl = toRun.some((item) =>
      item.steps.some((step) => step.action === "manualControl"),
    );
    const sequence = ++runSequence.current;
    const workerId = keepSessionRef.current
      ? (sessionWorkerId.current ??= `session-${Date.now()}`)
      : String(sequence);
    activeWorkerId.current = workerId;
    if (keepSessionRef.current) setSessionActive(true);
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
            workerId,
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
      if (!keepSessionRef.current) {
        await window.electronAPI.finishQaWorker(workerId);
        if (sessionWorkerId.current === workerId) sessionWorkerId.current = null;
      }
      activeWorkerId.current = null;
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
        setSessionActive(keepSessionRef.current);
        setRunNotification(
          (notification) =>
            notification && {
              ...notification,
              status: cancelled ? "cancelled" : failed ? "failed" : "passed",
              passed,
              failed,
            },
        );
        if (!cancelled) advanceStack();
      }
    })();
  };

  // 실행 전에 "세션 유지" 여부를 한 번 묻는다. "다시 묻지 않기"로 답하기 전까지는
  // 실행마다 다시 물어보고, 답하기 전에는 startRun을 보류한다.
  const beginRuns = (scenarios: Scenario[], background = false) => {
    if (!scenarios.length) {
      setRunValidationError(
        "실행할 시나리오가 없습니다. 편집기에서 시나리오를 작성하거나 시나리오 선택 화면에서 파일을 불러와 주세요.",
      );
      return;
    }
    if (!sessionPromptDismissed) {
      setSessionPromptPending({ scenarios, background });
      return;
    }
    startRun(scenarios, background);
  };

  const resolveSessionPrompt = (dontAskAgain: boolean) => {
    changeKeepSession(dontAskAgain);
    if (dontAskAgain) {
      setSessionPromptDismissed(true);
      try {
        window.localStorage.setItem(SESSION_PROMPT_STORAGE_KEY, "1");
      } catch {
        /* localStorage를 쓸 수 없으면 이번 세션에서만 유효하고, 다음 실행에 다시 묻는다. */
      }
    }
    const pending = sessionPromptPending;
    setSessionPromptPending(null);
    if (pending) startRun(pending.scenarios, pending.background);
  };

  // 완료된 배치의 runQueue·liveResults를 그대로 둔 채, 선택한 시나리오 하나만
  // 다시 실행한다. beginRuns와 달리 다른 시나리오의 표시된 결과를 지우지 않는다.
  const rerunScenario = (scenario: Scenario): void => {
    const sequence = ++runSequence.current;
    const workerId = keepSessionRef.current
      ? (sessionWorkerId.current ??= `session-${Date.now()}`)
      : String(sequence);
    activeWorkerId.current = workerId;
    if (keepSessionRef.current) setSessionActive(true);
    setRunning(true);
    runCancelled.current = false;
    setRunningScenario(scenario);
    setRunStartedAt(Date.now());
    setElapsedSeconds(0);
    setPreviewImage("");
    runProgressRef.current = { current: 0, total: scenario.steps.length, step: "" };
    setRunProgress(runProgressRef.current);
    setRunLog((logs) => [...logs, `[재실행] ${scenario.title} 실행 시작`]);
    void (async () => {
      let entry: ScenarioRunResult;
      let cancelled = false;
      try {
        runVideoScenario.current = scenario;
        const result = await window.electronAPI.runQa(scenario, {
          preview: livePreview,
          workerId,
        });
        if (sequence !== runSequence.current) {
          activeWorkerId.current = null;
          return;
        }
        setRunLog((logs) => [
          ...logs,
          ...result.log,
          `[재실행] ${scenario.title} ${result.status === "passed" ? "통과" : result.status === "cancelled" ? "취소" : "실패"}`,
        ]);
        if (result.status === "cancelled") {
          entry = { scenario, status: "cancelled" };
          cancelled = true;
        } else {
          entry = {
            scenario,
            status: result.status as "passed" | "failed",
            failedStepIndex:
              result.status === "failed"
                ? runProgressRef.current.current
                : undefined,
            message:
              result.status === "failed"
                ? result.log[result.log.length - 1]
                : undefined,
          };
        }
      } catch (error) {
        entry = {
          scenario,
          status: "failed",
          failedStepIndex: runProgressRef.current.current,
          message: error instanceof Error ? error.message : String(error),
        };
        setRunLog((logs) => [
          ...logs,
          `[재실행] ${scenario.title} 실행 실패`,
        ]);
      }
      if (!keepSessionRef.current) {
        await window.electronAPI.finishQaWorker(workerId);
        if (sessionWorkerId.current === workerId) sessionWorkerId.current = null;
      }
      activeWorkerId.current = null;
      if (sequence === runSequence.current) {
        setLiveResults((results) => [
          ...results.filter((result) => result.scenario.id !== scenario.id),
          entry,
        ]);
        setRunning(false);
        setSessionActive(keepSessionRef.current);
        if (!cancelled) advanceStack();
      }
    })();
  };

  // 일시정지 상태가 아니고 대기 중인 항목이 있으면 스택 맨 앞의 시나리오를 시작한다.
  // beginRuns/rerunScenario 완료 직후에 호출되므로 호출 시점에는 이미 running이 아니다.
  const advanceStack = (): void => {
    if (stackPausedRef.current) return;
    const stack = rerunStackRef.current;
    if (!stack.length) return;
    const [next, ...rest] = stack;
    rerunStackRef.current = rest;
    setRerunStack(rest);
    rerunScenario(next.scenario);
  };

  const queueRerun = (scenario: Scenario) => {
    if (!running && !stackPausedRef.current && !rerunStackRef.current.length) {
      rerunScenario(scenario);
      return;
    }
    const entry = {
      id: `rerun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scenario,
    };
    const next = [...rerunStackRef.current, entry];
    rerunStackRef.current = next;
    setRerunStack(next);
    showToast(`${scenario.title} 재실행을 대기열에 추가했습니다.`);
  };

  const removeFromStack = (id: string) => {
    const next = rerunStackRef.current.filter((item) => item.id !== id);
    rerunStackRef.current = next;
    setRerunStack(next);
    if (!next.length) {
      stackPausedRef.current = false;
      setStackPaused(false);
    }
  };

  const clearStack = () => {
    rerunStackRef.current = [];
    setRerunStack([]);
    stackPausedRef.current = false;
    setStackPaused(false);
  };

  const pauseStack = () => {
    stackPausedRef.current = true;
    setStackPaused(true);
  };

  const resumeStack = () => {
    stackPausedRef.current = false;
    setStackPaused(false);
    if (!running) advanceStack();
  };

  const endSession = () => {
    if (sessionWorkerId.current) {
      void window.electronAPI.finishQaWorker(sessionWorkerId.current);
      sessionWorkerId.current = null;
    }
    setSessionActive(false);
  };

  const changeKeepSession = (value: boolean) => {
    setKeepSession(value);
    keepSessionRef.current = value;
    if (value) {
      // 실행 도중 켰다면, 지금 사용 중인 브라우저를 그대로 유지 세션으로 승격시켜
      // 처음부터 다시 로그인하지 않고도 다음 실행부터 이어받게 한다.
      if (activeWorkerId.current) {
        sessionWorkerId.current = activeWorkerId.current;
        setSessionActive(true);
      }
      return;
    }
    // 실행 중에 끄면 지금 쓰고 있는 브라우저를 즉시 닫지 않고, 이번 실행이
    // 끝날 때 finishQaWorker로 정리되도록 둔다(진행 중인 단계가 끊기지 않도록).
    if (running) return;
    endSession();
  };

  const cancelRuns = () => {
    runCancelled.current = true;
    runSequence.current += 1;
    void window.electronAPI.cancelQa();
    // qa:cancel은 workerId와 무관하게 현재 브라우저를 즉시 닫으므로
    // 유지 중이던 세션도 함께 종료된 것으로 반영한다.
    sessionWorkerId.current = null;
    setSessionActive(false);
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
    keepSession,
    setKeepSession: changeKeepSession,
    sessionActive,
    endSession,
    sessionPromptOpen: sessionPromptPending !== null,
    resolveSessionPrompt,
    rerunStack,
    stackPaused,
    queueRerun,
    removeFromStack,
    clearStack,
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
  };
};

export type UseRunOrchestrationResult = ReturnType<typeof useRunOrchestration>;
