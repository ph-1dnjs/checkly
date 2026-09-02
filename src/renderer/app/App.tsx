import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
  type ReactElement,
} from "react";
import { DashboardPage } from "../pages/dashboard/DashboardPage";
import { ScenarioEditorPage } from "../pages/editor/ScenarioEditorPage";
import { RunPage } from "../pages/run/RunPage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import { ScenarioPickerPage } from "../pages/picker/ScenarioPickerPage";
import { BottomNavigation } from "../widgets/BottomNavigation";
import { RunReportDrawer } from "../widgets/RunReportDrawer";
import {
  markerColor,
  parseMarkdown,
  seedScenario,
  type Action,
  type MarkerPositionStore,
  type Route,
  type RunProgress,
  type RunRecord,
  type RunSummary,
  type Scenario,
  type ScenarioRunResult,
  type Step,
} from "../shared/model/scenario";

declare global {
  interface Window {
    electronAPI: {
      loadScenarioMarkdown: () => Promise<string | null>;
      saveScenarioMarkdown: (value: string) => Promise<void>;
      importScenarioFile: () => Promise<{
        markdown: string;
        filePath: string;
      } | null>;
      saveImportedScenarioFile: (value: string) => Promise<string | null>;
      exportScenarioFile: (value: string) => Promise<string | null>;
      selectUploadFile: () => Promise<string | null>;
      loadMarkerPositions: () => Promise<string | null>;
      saveMarkerPositions: (value: string) => Promise<void>;
      listScenarioFolder: () => Promise<{
        folderPath: string | null;
        files: Array<{ name: string; path: string; updatedAt: string }>;
      }>;
      chooseScenarioFolder: () => Promise<{
        folderPath: string | null;
        files: Array<{ name: string; path: string; updatedAt: string }>;
      }>;
      readScenarioFile: (filePath: string) => Promise<string | null>;
      inspectScenario: (
        value: Scenario,
      ) => Promise<Array<{ id: string; connected: boolean }>>;
      runQa: (
        value: Scenario,
        options?: { preview?: boolean; workerId?: string },
      ) => Promise<{ status: string; log: string[] }>;
      finishQaWorker: (workerId: string) => Promise<void>;
      downloadRunVideo: (value: string) => Promise<string | null>;
      mergeRunVideos: (values: string[]) => Promise<string | null>;
      submitManualInput: (value: string) => Promise<void>;
      submitManualControl: (result: { status: "continue" | "failed"; reason?: string }) => Promise<void>;
      controlManualBrowser: (event: { type: "click" | "wheel" | "key" | "text"; x?: number; y?: number; deltaY?: number; key?: string; text?: string }) => Promise<void>;
      submitManualResult: (result: { status: "passed" | "failed"; reason?: string }) => Promise<void>;
      cancelQa: () => Promise<void>;
      onManualInputRequired: (callback: (value: Step) => void) => () => void;
      onManualControlRequired: (callback: (value: Step & { timeoutSeconds?: number }) => void) => () => void;
      onManualResultRequired: (callback: (value: Step & { timeoutSeconds?: number }) => void) => () => void;
      onQaProgress: (callback: (value: RunProgress) => void) => () => void;
      onQaPreview: (callback: (value: string) => void) => () => void;
      onRunVideo: (callback: (value: string | null) => void) => () => void;
    };
  }
}

const initialMarkdown = `# 시나리오: 로그인\nurl: https://example.com/login\n\nGiven \`/login\` 페이지로 이동한다\nAnd \`이메일\`에 \`qa@example.com\` 입력\nAnd \`인증번호\` 수동 입력 [인증번호를 입력해 주세요.]\nAnd \`로그인\` 버튼 클릭\nThen \`대시보드\` 텍스트가 보인다`;
const positionKey = (scenario: Scenario) =>
  `${scenario.title}\n${scenario.url}`;
const applyPositions = (
  scenario: Scenario,
  store: MarkerPositionStore,
): Scenario => ({
  ...scenario,
  steps: scenario.steps.map((step) => {
    const position = store[positionKey(scenario)]?.find(
      (item) =>
        item.action === step.action &&
        item.target === step.target &&
        item.value === step.value &&
        item.prompt === step.prompt &&
        item.condition === step.condition &&
        item.waitSeconds === step.waitSeconds,
    );
    return position
      ? {
          ...step,
          occurrence: position.occurrence,
          x: position.x,
          y: position.y,
          color: position.color,
        }
      : step;
  }),
});
const scenarioToMarkdown = (scenario: Scenario): string =>
  [
    `# 시나리오: ${scenario.title}`,
    `url: ${scenario.url}`,
    "",
    ...scenario.steps.map((step, index) => {
      const prefix =
        index === 0 ? "Given" : step.action === "expectText" ? "Then" : "And";
      const action =
        step.action === "goto"
          ? `\`${step.target}\` 페이지로 이동한다`
            : step.action === "fill"
              ? `\`${step.target}\`에 \`${step.value ?? ""}\` 입력`
              : step.action === "fileUpload"
                ? `\`${step.target}\`에 \`${step.value ?? ""}\` 파일 업로드`
              : step.action === "manualFill"
              ? `\`${step.target}\` 수동 입력${step.prompt ? ` [${step.prompt}]` : ""}`
              : step.action === "manualControl"
                ? `\`${step.target}\` 브라우저 직접 제어${step.prompt ? ` [${step.prompt}]` : ""}`
              : step.action === "manualResult"
                ? `\`${step.target}\` 수동 결과 확인${step.prompt ? ` [${step.prompt}]` : ""}`
              : step.action === "select"
                ? `\`${step.target}\`에서 \`${step.value ?? ""}\` 선택`
                : step.action === "expectText"
                  ? `\`${step.target}\` 텍스트가 보인다${step.waitSeconds ? ` [대기 ${step.waitSeconds}초]` : ""}`
                  : `\`${step.target}\`${step.occurrence && step.occurrence > 1 ? ` [${step.occurrence}번째]` : ""} 클릭${step.waitSeconds ? ` [대기 ${step.waitSeconds}초]` : ""}`;
      return `${prefix} ${step.condition ? `화면에 \`${step.condition}\`가 있는 경우 ` : ""}${action}`;
    }),
  ].join("\n");
const replaceScenarioMarkdown = (
  sourceMarkdown: string,
  scenario: Scenario,
): string => {
  const blocks = sourceMarkdown
    .split(/(?=^#{1,3}\s*시나리오:|^Scenario:)/im)
    .filter(Boolean);
  const index = parseMarkdown(sourceMarkdown).findIndex(
    (item) =>
      item.id === scenario.id ||
      (item.title === scenario.title && item.url === scenario.url),
  );
  if (index < 0) return scenarioToMarkdown(scenario);
  blocks[index] = scenarioToMarkdown(scenario);
  return blocks.join("\n\n").trim();
};

type RunNotification = {
  total: number;
  currentScenario: number;
  scenarioTitle: string;
  status: "running" | "passed" | "failed" | "cancelled";
  passed: number;
  failed: number;
};

export const App = (): ReactElement => {
  const [scenario, setScenario] = useState(seedScenario);
  const [sourceMarkdown, setSourceMarkdown] = useState(initialMarkdown);
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown);
  const [markerScenarioId, setMarkerScenarioId] = useState("");
  const [scenarioFilePath, setScenarioFilePath] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>("dashboard");
  const [editorMode, setEditorMode] = useState<"text" | "marker">("text");
  const [selectedId, setSelectedId] = useState("3");
  const [editingMarker, setEditingMarker] = useState<Step | null>(null);
  const [pendingMarker, setPendingMarker] = useState<Step | null>(null);
  const [isAddingMarker, setIsAddingMarker] = useState(false);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [stepPanelCollapsed, setStepPanelCollapsed] = useState(false);
  const [stepPanelPosition, setStepPanelPosition] = useState({
    top: 78,
    left: 24,
  });
  const [stepPanelDrag, setStepPanelDrag] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [stepPanelMoved, setStepPanelMoved] = useState(false);
  const [saveBeforeReturning, setSaveBeforeReturning] = useState(false);
  const [manual, setManual] = useState<Step | null>(null);
  const [manualControl, setManualControl] = useState<(Step & { timeoutSeconds?: number }) | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [manualValueVisible, setManualValueVisible] = useState(false);
  const [manualResult, setManualResult] = useState<(Step & { timeoutSeconds?: number }) | null>(null);
  const [manualFailureReason, setManualFailureReason] = useState("");
  const [running, setRunning] = useState(false);
  const [runningScenario, setRunningScenario] = useState(seedScenario);
  const [runLog, setRunLog] = useState<string[]>([]);
  const [runProgress, setRunProgress] = useState<RunProgress>({
    current: 0,
    total: seedScenario.steps.length,
    step: "",
  });
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [livePreview, setLivePreview] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const [runVideos, setRunVideos] = useState<Array<{ scenario: Scenario; path: string }>>([]);
  const [fullRunVideoPath, setFullRunVideoPath] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [runNotification, setRunNotification] =
    useState<RunNotification | null>(null);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummary>({
    total: 0,
    passed: 0,
    failed: 0,
  });
  const [positionStore, setPositionStore] = useState<MarkerPositionStore>({});
  const [liveResults, setLiveResults] = useState<ScenarioRunResult[]>([]);
  const [openRunRecord, setOpenRunRecord] = useState<RunRecord | null>(null);
  const runCancelled = useRef(false);
  const runSequence = useRef(0);
  const runVideoPaths = useRef<string[]>([]);
  const runVideoScenario = useRef<Scenario | null>(null);
  const runProgressRef = useRef<RunProgress>(runProgress);

  const updateSteps = (steps: Step[]) =>
    setScenario((current) => ({
      ...current,
      steps: steps.map((step, index) => ({ ...step, id: String(index + 1) })),
    }));

  useEffect(() => {
    Promise.all([
      window.electronAPI.loadScenarioMarkdown(),
      window.electronAPI.loadMarkerPositions(),
    ])
      .then(([markdown, raw]) => {
        const store = JSON.parse(raw ?? "{}") as MarkerPositionStore;
        setPositionStore(store);
        if (markdown) {
          setSourceMarkdown(markdown);
          setSavedMarkdown(markdown);
          const first = parseMarkdown(markdown)[0];
          if (first) {
            setScenario(applyPositions(first, store));
            setMarkerScenarioId(first.id);
          }
        }
      })
      .catch(() => setToast("저장된 시나리오를 불러오지 못했습니다."));
  }, []);

  useEffect(() => {
    setPositionStore((store) => ({
      ...store,
      [positionKey(scenario)]: scenario.steps.flatMap((step) =>
        step.x === undefined || step.y === undefined
          ? []
          : [
              {
                action: step.action,
                target: step.target,
                value: step.value,
                prompt: step.prompt,
                condition: step.condition,
                waitSeconds: step.waitSeconds,
                occurrence: step.occurrence,
                x: step.x,
                y: step.y,
                color: step.color,
              },
            ],
      ),
    }));
  }, [scenario]);

  useEffect(() => {
    void window.electronAPI
      .saveMarkerPositions(JSON.stringify(positionStore))
      .catch(() => setToast("마커 위치를 저장하지 못했습니다."));
  }, [positionStore]);

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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!stepPanelDrag) return;
    const move = (event: globalThis.PointerEvent) => {
      setStepPanelMoved(true);
      setStepPanelPosition({
        top: Math.max(16, event.clientY - stepPanelDrag.y),
        left: Math.max(16, event.clientX - stepPanelDrag.x),
      });
    };
    const stop = () => setStepPanelDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [stepPanelDrag]);

  useEffect(() => {
    if (route !== "editor" || editorMode !== "marker") return;
    void window.electronAPI
      .inspectScenario(scenario)
      .then((matches) =>
        updateSteps(
          scenario.steps.map((step) => ({
            ...step,
            connected: matches.some(
              (match) => match.id === step.id && match.connected,
            ),
          })),
        ),
      )
      .catch(() => setToast("대상 페이지를 확인하지 못했습니다."));
  }, [route, editorMode]);

  const previews = useMemo(
    () => parseMarkdown(sourceMarkdown),
    [sourceMarkdown],
  );
  const executableScenario = useMemo(() => {
    const savedScenario = parseMarkdown(sourceMarkdown).find(
      (item) => item.id === scenario.id,
    );
    return savedScenario
      ? applyPositions(savedScenario, positionStore)
      : scenario;
  }, [positionStore, scenario, sourceMarkdown]);
  const executableScenarios = useMemo(
    () => previews.map((item) => applyPositions(item, positionStore)),
    [positionStore, previews],
  );

  const markerDialog = pendingMarker ?? editingMarker;
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

  const updateSource = (markdown: string) => {
    setSourceMarkdown(markdown);
    const next = parseMarkdown(markdown)[0];
    if (next) {
      const positioned = applyPositions(next, positionStore);
      setScenario(positioned);
      setMarkerScenarioId(positioned.id);
      setSelectedId(positioned.steps[0]?.id ?? "");
    }
  };

  const importScenario = async () => {
    const imported = await window.electronAPI.importScenarioFile();
    if (!imported) return;
    updateSource(imported.markdown);
    setScenarioFilePath(imported.filePath);
    await window.electronAPI.saveScenarioMarkdown(imported.markdown);
    setSavedMarkdown(imported.markdown);
    setToast("시나리오를 불러왔습니다.");
  };

  const saveScenarioFile = async () => {
    try {
      const filePath = scenarioFilePath
        ? await window.electronAPI.saveImportedScenarioFile(sourceMarkdown)
        : await window.electronAPI.exportScenarioFile(sourceMarkdown);
      if (!filePath) return;
      setScenarioFilePath(filePath);
      await window.electronAPI.saveScenarioMarkdown(sourceMarkdown);
      setSavedMarkdown(sourceMarkdown);
      setToast("시나리오를 저장했습니다.");
    } catch {
      setToast("시나리오를 저장하지 못했습니다.");
    }
  };

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
    const toRun = scenarios.length ? scenarios : [scenario];
    const includesManualControl = toRun.some((item) =>
      item.steps.some((step) => step.action === "manualControl"),
    );
    const sequence = ++runSequence.current;
    if (!background) setRoute("run");
    setRunning(true);
    runCancelled.current = false;
    setRunningScenario(toRun[0]);
    setRunStartedAt(Date.now());
    setElapsedSeconds(0);
    setPreviewImage("");
    setRunVideos([]);
    setFullRunVideoPath(null);
    runVideoPaths.current = [];
    runVideoScenario.current = null;
    setLiveResults([]);
    runProgressRef.current = { current: 0, total: toRun[0].steps.length, step: "" };
    setRunProgress(runProgressRef.current);
    setRunLog([
      `${toRun.length}개 시나리오 실행을 시작했습니다.`,
      ...(includesManualControl
        ? ["브라우저 직접 제어 단계에서는 실행 화면에서 같은 브라우저 세션을 조작할 수 있습니다."]
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
            const videoPath = await window.electronAPI.mergeRunVideos(runVideoPaths.current);
            setFullRunVideoPath(videoPath);
          } catch {
            setToast("전체 시나리오 영상을 만들지 못했습니다.");
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

  const runEditorContent = () => {
    const markdown =
      editorMode === "marker"
        ? replaceScenarioMarkdown(sourceMarkdown, scenario)
        : sourceMarkdown;
    const scenarios = parseMarkdown(markdown).map((item) =>
      editorMode === "marker" && item.id === scenario.id
        ? scenario
        : applyPositions(item, positionStore),
    );
    setSourceMarkdown(markdown);
    beginRuns(scenarios, true);
  };

  const placeMarker = ({
    x,
    y,
    target,
    action,
  }: {
    x: number;
    y: number;
    target: string;
    action: Action;
  }) => {
    const index = scenario.steps.length;
    setPendingMarker({
      id: String(index + 1),
      action,
      target,
      connected: true,
      x,
      y,
      color: markerColor(index),
    });
    setIsAddingMarker(false);
  };

  const updateMarker = (changes: Partial<Step>) => {
    if (pendingMarker) setPendingMarker({ ...pendingMarker, ...changes });
    if (editingMarker) setEditingMarker({ ...editingMarker, ...changes });
  };

  const completeMarker = () => {
    if (!markerDialog?.target.trim()) return;
    updateSteps(
      pendingMarker
        ? [...scenario.steps, pendingMarker]
        : scenario.steps.map((step) =>
            step.id === editingMarker?.id ? editingMarker : step,
          ),
    );
    setSelectedId(markerDialog.id);
    setPendingMarker(null);
    setEditingMarker(null);
  };

  const saveMarkerEditsAndReturn = async () => {
    const markdown = replaceScenarioMarkdown(sourceMarkdown, scenario);
    updateSource(markdown);
    try {
      await window.electronAPI.saveScenarioMarkdown(markdown);
      if (scenarioFilePath)
        await window.electronAPI.saveImportedScenarioFile(markdown);
      setSavedMarkdown(markdown);
      setToast("시나리오를 저장했습니다.");
    } catch {
      setToast("시나리오를 저장하지 못했습니다.");
    } finally {
      setSaveBeforeReturning(false);
      setEditorMode("text");
    }
  };

  const selectMarkerScenario = (id: string) => {
    const nextMarkdown = replaceScenarioMarkdown(sourceMarkdown, scenario);
    const nextScenario = parseMarkdown(nextMarkdown).find(
      (item) => item.id === id,
    );
    if (!nextScenario) return;
    const positioned = applyPositions(nextScenario, positionStore);
    setSourceMarkdown(nextMarkdown);
    setScenario(positioned);
    setMarkerScenarioId(id);
    setSelectedId(positioned.steps[0]?.id ?? "");
  };

  const panelDrag = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setStepPanelMoved(false);
    setStepPanelDrag({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  const reorderSteps = (draggedId: string, targetId: string) => {
    const fromIndex = scenario.steps.findIndex((step) => step.id === draggedId);
    const targetIndex = scenario.steps.findIndex(
      (step) => step.id === targetId,
    );
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;

    const reordered = [...scenario.steps];
    const [draggedStep] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, draggedStep);
    const selectedStep = scenario.steps.find((step) => step.id === selectedId);
    updateSteps(reordered);
    if (selectedStep)
      setSelectedId(String(reordered.indexOf(selectedStep) + 1));
  };

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
            isDirty={sourceMarkdown !== savedMarkdown}
            scenarioFilePath={scenarioFilePath}
            previews={previews}
            markerScenarioId={markerScenarioId || previews[0]?.id || ""}
            selectedId={selectedId}
            isAddingMarker={isAddingMarker}
            markersVisible={markersVisible}
            stepPanelCollapsed={stepPanelCollapsed}
            stepPanelPosition={stepPanelPosition}
            stepPanelMoved={stepPanelMoved}
            markerDialog={markerDialog}
            pendingMarker={pendingMarker}
            webviewKey={0}
            onModeChange={setEditorMode}
            onSelectMarkerScenario={selectMarkerScenario}
            onImport={() => void importScenario()}
            onExport={() => void saveScenarioFile()}
            onSelectUploadFile={() => window.electronAPI.selectUploadFile()}
            onRun={runEditorContent}
            onSourceChange={updateSource}
            onScenarioChange={setScenario}
            onRefresh={() => undefined}
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
            onStepPanelDrag={panelDrag}
            onToggleStepPanel={setStepPanelCollapsed}
            onUpdateMarkerDialog={updateMarker}
            onCloseMarkerDialog={() => {
              setPendingMarker(null);
              setEditingMarker(null);
            }}
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
            scenarios={executableScenarios}
            scenarioResults={liveResults}
            running={running}
            manual={manual}
            manualValue={manualValue}
            manualValueVisible={manualValueVisible}
            onManualValueChange={setManualValue}
            onToggleManualValueVisible={() =>
              setManualValueVisible((visible) => !visible)
            }
            onSubmitManualInput={() => {
              void window.electronAPI.submitManualInput(manualValue);
              setManual(null);
              setManualValue("");
            }}
            onCancelManual={() => void window.electronAPI.cancelQa()}
            manualControl={manualControl}
            manualResult={manualResult}
            runLog={runLog}
            runProgress={runProgress}
            elapsedSeconds={elapsedSeconds}
            runStartedAt={runStartedAt}
            livePreview={livePreview}
            previewImage={previewImage}
            onManualBrowserEvent={(event) => void window.electronAPI.controlManualBrowser(event)}
            onCompleteManualControl={() => {
              void window.electronAPI.submitManualControl({ status: "continue" });
              setManualControl(null);
            }}
            onFailManualControl={(reason) => {
              void window.electronAPI.submitManualControl({ status: "failed", reason });
              setManualControl(null);
            }}
            onGoToPicker={() => setRoute("picker")}
            onCancel={cancelRuns}
            onLivePreviewChange={setLivePreview}
            runVideos={runVideos}
            fullRunVideoAvailable={Boolean(fullRunVideoPath)}
            onDownloadRunVideo={(videoPath) => {
              if (!videoPath) return;
              void window.electronAPI
                .downloadRunVideo(videoPath)
                .then((filePath) => {
                  if (filePath) setToast("실행 영상을 다운로드했습니다.");
                })
                .catch(() =>
                  setToast("실행 영상을 다운로드하지 못했습니다."),
                );
            }}
            onDownloadFullRunVideo={() => {
              if (!fullRunVideoPath) return;
              void window.electronAPI
                .downloadRunVideo(fullRunVideoPath)
                .then((filePath) => {
                  if (filePath) setToast("전체 시나리오 영상을 다운로드했습니다.");
                })
                .catch(() => setToast("전체 시나리오 영상을 다운로드하지 못했습니다."));
            }}
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
        onRun={() => beginRuns(executableScenarios)}
        onCancel={cancelRuns}
      />
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
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manual-result-title">
          <div className="manual-modal">
            <h2 id="manual-result-title">수동 결과 확인이 필요합니다</h2>
            <p>{manualResult.prompt || `${manualResult.target} 진행 후 결과를 선택해 주세요.`}</p>
            <p className="security-note">최대 5분 동안 대기합니다. 실패를 선택하면 사유가 실행 로그와 보고서에 기록됩니다.</p>
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
                onClick={() => {
                  void window.electronAPI.submitManualResult({ status: "failed", reason: manualFailureReason.trim() });
                  setManualResult(null);
                }}
              >
                실패로 기록
              </button>
              <button
                className="button button-primary"
                onClick={() => {
                  void window.electronAPI.submitManualResult({ status: "passed" });
                  setManualResult(null);
                }}
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
