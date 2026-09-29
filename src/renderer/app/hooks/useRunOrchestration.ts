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

export type RunTimelineStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "cancelled";
export type RunTimelineEntry = {
  seq: number;
  scenario: Scenario;
  status: RunTimelineStatus;
  totalSteps: number;
  finishedStep?: number;
  elapsedSeconds?: number;
};

type UseRunOrchestrationOptions = {
  showToast: (message: string) => void;
  setRoute: (route: Route) => void;
};

const SESSION_PROMPT_STORAGE_KEY = "checkly:keepSessionPromptAnswer";
type SessionPromptAnswer = "keep" | "skip" | null;

const readSessionPromptAnswer = (): SessionPromptAnswer => {
  try {
    const value = window.localStorage.getItem(SESSION_PROMPT_STORAGE_KEY);
    return value === "keep" || value === "skip" ? value : null;
  } catch {
    return null;
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
  const [keepSession, setKeepSession] = useState(
    () => readSessionPromptAnswer() === "keep",
  );
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionPromptDismissed, setSessionPromptDismissed] = useState(
    () => readSessionPromptAnswer() !== null,
  );
  const [sessionPromptPending, setSessionPromptPending] = useState<{
    scenarios: Scenario[];
    background: boolean;
  } | null>(null);
  const [runTimeline, setRunTimeline] = useState<RunTimelineEntry[]>([]);
  const [stackPaused, setStackPaused] = useState(false);
  const runCancelled = useRef(false);
  const runSequence = useRef(0);
  const runTimelineRef = useRef<RunTimelineEntry[]>([]);
  const timelineSeq = useRef(0);
  const stackPausedRef = useRef(false);
  // 재실행 대기열에서 "실행 중" 항목을 제거 요청받은 seq. 해당 실행이 취소로
  // 끝나면 결과 카드를 남기는 대신 대기열에서 바로 지우고 다음 항목으로 넘어간다.
  const skipSeqRef = useRef<number | null>(null);
  const sessionWorkerId = useRef<string | null>(null);
  const keepSessionRef = useRef(keepSession);
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

  const pushTimelineEntry = (scenario: Scenario): number => {
    const seq = ++timelineSeq.current;
    const next: RunTimelineEntry[] = [
      ...runTimelineRef.current,
      { seq, scenario, status: "queued", totalSteps: scenario.steps.length },
    ];
    runTimelineRef.current = next;
    setRunTimeline(next);
    return seq;
  };

  const updateTimelineEntry = (
    seq: number,
    patch: Partial<RunTimelineEntry>,
  ) => {
    const next = runTimelineRef.current.map((entry) =>
      entry.seq === seq ? { ...entry, ...patch } : entry,
    );
    runTimelineRef.current = next;
    setRunTimeline(next);
  };

  const removeTimelineEntry = (seq: number) => {
    const next = runTimelineRef.current.filter((entry) => entry.seq !== seq);
    runTimelineRef.current = next;
    setRunTimeline(next);
  };

  const clearDoneTimelineEntries = () => {
    const next = runTimelineRef.current.filter(
      (entry) => entry.status === "queued" || entry.status === "running",
    );
    runTimelineRef.current = next;
    setRunTimeline(next);
  };

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
    const timelineSeqs = toRun.map((item) => pushTimelineEntry(item));
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
        updateTimelineEntry(timelineSeqs[index], { status: "running" });
        const attemptStartedAt = Date.now();
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
          const attemptElapsed = Math.round(
            (Date.now() - attemptStartedAt) / 1000,
          );
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
            updateTimelineEntry(timelineSeqs[index], {
              status: result.status,
              finishedStep:
                result.status === "failed"
                  ? runProgressRef.current.current
                  : runScenario.steps.length,
              elapsedSeconds: attemptElapsed,
            });
          }
          if (result.status === "cancelled") {
            // 대기열의 "실행 중" 카드에서 개별 취소(제거)를 요청받은 경우, 배치
            // 전체를 중단하지 않고 이 항목만 대기열에서 지운 뒤 다음 시나리오로 넘어간다.
            const skipped = skipSeqRef.current === timelineSeqs[index];
            if (skipped) skipSeqRef.current = null;
            if (skipped) {
              removeTimelineEntry(timelineSeqs[index]);
              continue;
            }
            const entry: ScenarioRunResult = {
              scenario: runScenario,
              status: "cancelled",
            };
            collected.push(entry);
            setLiveResults((r) => [...r, entry]);
            updateTimelineEntry(timelineSeqs[index], {
              status: "cancelled",
              finishedStep: runProgressRef.current.current,
              elapsedSeconds: attemptElapsed,
            });
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
          updateTimelineEntry(timelineSeqs[index], {
            status: "failed",
            finishedStep: runProgressRef.current.current,
            elapsedSeconds: Math.round((Date.now() - attemptStartedAt) / 1000),
          });
          setRunLog((logs) => [
            ...logs,
            `[${index + 1}/${toRun.length}] ${runScenario.title} 실행 실패`,
          ]);
        }
      }
      // 중단으로 실행되지 못한 나머지 항목은 대기열 표시에서 제거한다.
      if (cancelled) {
        for (const seq of timelineSeqs) {
          const entry = runTimelineRef.current.find((item) => item.seq === seq);
          if (entry?.status === "queued") removeTimelineEntry(seq);
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

  // keep: 눌린 버튼("세션 유지" vs "닫기")에 따른 값. dontAskAgain: 체크박스 값으로,
  // 켜져 있으면 이번에 누른 버튼이 이후 실행에도 계속 적용되어 다시 묻지 않는다.
  const resolveSessionPrompt = (keep: boolean, dontAskAgain: boolean) => {
    changeKeepSession(keep);
    if (dontAskAgain) {
      setSessionPromptDismissed(true);
      try {
        window.localStorage.setItem(
          SESSION_PROMPT_STORAGE_KEY,
          keep ? "keep" : "skip",
        );
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
  // seq는 호출 전에 이미 만들어진 대기열 타임라인 항목을 가리킨다.
  const rerunScenario = (scenario: Scenario, seq: number): void => {
    const sequence = ++runSequence.current;
    const workerId = keepSessionRef.current
      ? (sessionWorkerId.current ??= `session-${Date.now()}`)
      : String(sequence);
    activeWorkerId.current = workerId;
    if (keepSessionRef.current) setSessionActive(true);
    updateTimelineEntry(seq, { status: "running" });
    const attemptStartedAt = Date.now();
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
      let finalStatus: RunTimelineStatus = "failed";
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
          finalStatus = "cancelled";
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
          finalStatus = result.status as "passed" | "failed";
        }
      } catch (error) {
        entry = {
          scenario,
          status: "failed",
          failedStepIndex: runProgressRef.current.current,
          message: error instanceof Error ? error.message : String(error),
        };
        finalStatus = "failed";
        setRunLog((logs) => [
          ...logs,
          `[재실행] ${scenario.title} 실행 실패`,
        ]);
      }
      const skipped = skipSeqRef.current === seq;
      if (skipped) skipSeqRef.current = null;
      if (skipped) {
        removeTimelineEntry(seq);
      } else {
        updateTimelineEntry(seq, {
          status: finalStatus,
          finishedStep:
            finalStatus === "passed"
              ? scenario.steps.length
              : runProgressRef.current.current,
          elapsedSeconds: Math.round((Date.now() - attemptStartedAt) / 1000),
        });
      }
      if (!keepSessionRef.current) {
        await window.electronAPI.finishQaWorker(workerId);
        if (sessionWorkerId.current === workerId) sessionWorkerId.current = null;
      }
      activeWorkerId.current = null;
      if (sequence === runSequence.current) {
        if (!skipped) {
          setLiveResults((results) => [
            ...results.filter((result) => result.scenario.id !== scenario.id),
            entry,
          ]);
        }
        setRunning(false);
        setSessionActive(keepSessionRef.current);
        if (skipped || !cancelled) advanceStack();
      }
    })();
  };

  // 일시정지 상태가 아니고 대기 중인 항목이 있으면 대기열 맨 앞의 시나리오를 시작한다.
  // startRun/rerunScenario 완료 직후에 호출되므로 호출 시점에는 이미 running이 아니다.
  const advanceStack = (): void => {
    if (stackPausedRef.current) return;
    const next = runTimelineRef.current.find(
      (entry) => entry.status === "queued",
    );
    if (!next) return;
    rerunScenario(next.scenario, next.seq);
  };

  const queueRerun = (scenario: Scenario) => {
    const canRunImmediately =
      !running &&
      !stackPausedRef.current &&
      !runTimelineRef.current.some((entry) => entry.status === "queued");
    const seq = pushTimelineEntry(scenario);
    if (canRunImmediately) {
      rerunScenario(scenario, seq);
    } else {
      showToast(`${scenario.title} 재실행을 대기열에 추가했습니다.`);
    }
  };

  // 대기 중인 항목은 바로 목록에서 지운다. 실행 중인 항목은 그 시나리오의 실행만
  // 취소하고(브라우저 세션은 유지) 완료 시점에 rerunScenario가 대기열에서 제거한 뒤
  // 다음 항목으로 이어서 진행한다.
  const removeFromStack = (seq: number) => {
    const entry = runTimelineRef.current.find((item) => item.seq === seq);
    if (!entry) return;
    if (entry.status === "running") {
      skipSeqRef.current = seq;
      void window.electronAPI.cancelQa({ keepWorker: true });
      return;
    }
    removeTimelineEntry(seq);
  };

  const clearDoneRecords = () => {
    clearDoneTimelineEntries();
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
    // runSequence를 앞당겼기 때문에 startRun/rerunScenario의 완료 처리가
    // sequence 불일치로 건너뛰어질 수 있다. 현재 "running"으로 남아 있는
    // 대기열 항목을 여기서 직접 취소 처리해 유령 카드로 남지 않게 한다.
    const runningEntry = runTimelineRef.current.find(
      (entry) => entry.status === "running",
    );
    if (runningEntry) {
      updateTimelineEntry(runningEntry.seq, {
        status: "cancelled",
        finishedStep: runProgressRef.current.current,
        elapsedSeconds,
      });
    }
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
  };
};

export type UseRunOrchestrationResult = ReturnType<typeof useRunOrchestration>;
