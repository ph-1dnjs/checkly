import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { DashboardPage } from "../pages/dashboard/DashboardPage";
import { ScenarioEditorPage } from "../pages/editor/ScenarioEditorPage";
import { RunPage } from "../pages/run/RunPage";
import { BottomNavigation } from "../widgets/BottomNavigation";
import {
  markerColor,
  seedScenario,
  type MarkerPositionStore,
  type Route,
  type RunProgress,
  type RunRecord,
  type RunSummary,
  type Scenario,
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
      loadMarkerPositions: () => Promise<string | null>;
      saveMarkerPositions: (value: string) => Promise<void>;
      inspectScenario: (
        value: Scenario,
      ) => Promise<Array<{ id: string; connected: boolean }>>;
      runQa: (
        value: Scenario,
        options?: { preview?: boolean; workerId?: string },
      ) => Promise<{ status: string; log: string[] }>;
      finishQaWorker: (workerId: string) => Promise<void>;
      openFailureVideo: (value: string) => Promise<void>;
      submitManualInput: (value: string) => Promise<void>;
      cancelQa: () => Promise<void>;
      onManualInputRequired: (callback: (value: Step) => void) => () => void;
      onQaProgress: (callback: (value: RunProgress) => void) => () => void;
      onQaPreview: (callback: (value: string) => void) => () => void;
      onFailureVideo: (callback: (value: string | null) => void) => () => void;
    };
  }
}

const initialMarkdown = `# 시나리오: 로그인\nurl: https://example.com/login\n\nGiven /login 페이지로 이동한다\nAnd 이메일에 'qa@example.com' 입력\nAnd 인증번호 수동 입력 [인증번호를 입력해 주세요.]\nAnd 로그인 버튼 클릭\nThen 대시보드 텍스트가 보인다`;
const positionKey = (scenario: Scenario) =>
  `${scenario.title}\n${scenario.url}`;
const parseMarkdown = (markdown: string): Scenario[] =>
  markdown
    .split(/(?=^#{1,3}\s*시나리오:|^Scenario:)/im)
    .filter(Boolean)
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const title =
        lines[0].match(/^#{1,3}\s*시나리오:\s*(.+)$/i)?.[1] ||
        `시나리오 ${index + 1}`;
      const url =
        lines
          .find((line) => line.startsWith("url:"))
          ?.slice(4)
          .trim() || seedScenario.url;
      const steps = lines
        .filter((line) => /^(Given|When|Then|And|But)\s+/i.test(line))
        .map((line, stepIndex): Step => {
          const text = line.replace(/^(Given|When|Then|And|But)\s+/i, "");
          const result = text
            .replace(
              /\s*(텍스트가\s*)?(보인다|포함된다|확인된다|표시된다).*/,
              "",
            )
            .trim();
          const manual = text.match(/^(.+?)\s+수동 입력(?:\s*\[(.+)\])?$/);
          const fill = text.match(
            /^(.+?)(?:에|을|를)?\s*['"](.*)['"]\s*(?:자동\s*)?(?:입력|작성)/,
          );
          const select = text.match(/^(.+?)(?:에서|에)\s*['"](.*)['"]\s*선택/);
          if (/보인다|포함된다|확인된다|표시된다|결과\s*확인/.test(text))
            return {
              id: String(stepIndex + 1),
              action: "expectText",
              target: result,
              connected: false,
            };
          if (manual)
            return {
              id: String(stepIndex + 1),
              action: "manualFill",
              target: manual[1],
              prompt: manual[2],
              required: true,
              connected: true,
            };
          if (fill)
            return {
              id: String(stepIndex + 1),
              action: "fill",
              target: fill[1],
              value: fill[2],
              connected: true,
            };
          if (select)
            return {
              id: String(stepIndex + 1),
              action: "select",
              target: select[1],
              value: select[2],
              connected: true,
            };
          if (/(페이지로?\s*이동|접속|열기)/.test(text))
            return {
              id: String(stepIndex + 1),
              action: "goto",
              target:
                text.replace(/\s*(페이지로?\s*이동|접속|열기).*/, "").trim() ||
                "/",
              connected: true,
            };
          return {
            id: String(stepIndex + 1),
            action: "click",
            target: text.replace(/\s+(버튼을?|버튼)?\s*클릭.*/, "").trim(),
            connected: true,
          };
        });
      return { id: `scenario-${index}`, title, url, steps };
    });
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
        item.prompt === step.prompt,
    );
    return position
      ? { ...step, x: position.x, y: position.y, color: position.color }
      : step;
  }),
});
const scenarioToMarkdown = (scenario: Scenario): string =>
  [
    `# 시나리오: ${scenario.title}`,
    `url: ${scenario.url}`,
    "",
    ...scenario.steps.map((step, index) => {
      const prefix = index === 0 ? "Given" : step.action === "expectText" ? "Then" : "And";
      if (step.action === "goto") return `${prefix} ${step.target} 페이지로 이동한다`;
      if (step.action === "fill") return `${prefix} ${step.target}에 '${step.value ?? ""}' 입력`;
      if (step.action === "manualFill") return `${prefix} ${step.target} 수동 입력${step.prompt ? ` [${step.prompt}]` : ""}`;
      if (step.action === "select") return `${prefix} ${step.target}에서 '${step.value ?? ""}' 선택`;
      if (step.action === "expectText") return `${prefix} ${step.target} 텍스트가 보인다`;
      return `${prefix} ${step.target} 버튼 클릭`;
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
    (item) => item.id === scenario.id,
  );
  if (index < 0) return scenarioToMarkdown(scenario);
  blocks[index] = scenarioToMarkdown(scenario);
  return blocks.join("\n\n").trim();
};

export const App = (): ReactElement => {
  const [scenario, setScenario] = useState(seedScenario);
  const [sourceMarkdown, setSourceMarkdown] = useState(initialMarkdown);
  const [scenarioFilePath, setScenarioFilePath] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>("scenarios");
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
  const [manualValue, setManualValue] = useState("");
  const [manualValueVisible, setManualValueVisible] = useState(false);
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
  const [failureVideoPath, setFailureVideoPath] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummary>({
    total: 0,
    passed: 0,
    failed: 0,
  });
  const [positionStore, setPositionStore] = useState<MarkerPositionStore>({});
  const runCancelled = useRef(false);
  const runSequence = useRef(0);

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
          const first = parseMarkdown(markdown)[0];
          if (first) setScenario(applyPositions(first, store));
        }
      })
      .catch(() => setNotice("저장된 시나리오를 불러오지 못했습니다."));
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
      .catch(() => setNotice("마커 위치를 저장하지 못했습니다."));
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
      window.electronAPI.onQaProgress((progress) => {
        setRunProgress(progress);
        setRunLog((logs) => [
          ...logs,
          `${progress.current}/${progress.total} ${progress.step}`,
        ]);
      }),
    [],
  );

  useEffect(() => window.electronAPI.onQaPreview(setPreviewImage), []);

  useEffect(() => window.electronAPI.onFailureVideo(setFailureVideoPath), []);

  useEffect(() => {
    if (!running || !runStartedAt) return;
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - runStartedAt) / 1000)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [running, runStartedAt]);

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
      .catch(() => setNotice("대상 페이지를 확인하지 못했습니다."));
  }, [route, editorMode]);

  const previews = useMemo(() => parseMarkdown(sourceMarkdown), [sourceMarkdown]);
  const executableScenario = useMemo(() => {
    const savedScenario = parseMarkdown(sourceMarkdown).find(
      (item) => item.id === scenario.id,
    );
    return savedScenario
      ? applyPositions(savedScenario, positionStore)
      : scenario;
  }, [positionStore, scenario, sourceMarkdown]);
  const executableScenarios = useMemo(
    () =>
      previews.map((item) => applyPositions(item, positionStore)),
    [positionStore, previews],
  );

  const markerDialog = pendingMarker ?? editingMarker;

  const updateSource = (markdown: string) => {
    setSourceMarkdown(markdown);
    const next = parseMarkdown(markdown)[0];
    if (next) {
      const positioned = applyPositions(next, positionStore);
      setScenario(positioned);
      setSelectedId(positioned.steps[0]?.id ?? "");
    }
  };

  const importScenario = async () => {
    const imported = await window.electronAPI.importScenarioFile();
    if (!imported) return;
    updateSource(imported.markdown);
    setScenarioFilePath(imported.filePath);
    await window.electronAPI.saveScenarioMarkdown(imported.markdown);
    setNotice("시나리오를 불러왔습니다.");
  };

  const saveScenarioFile = async () => {
    try {
      const filePath = scenarioFilePath
        ? await window.electronAPI.saveImportedScenarioFile(sourceMarkdown)
        : await window.electronAPI.exportScenarioFile(sourceMarkdown);
      if (!filePath) return;
      setScenarioFilePath(filePath);
      await window.electronAPI.saveScenarioMarkdown(sourceMarkdown);
      setNotice("시나리오를 저장했습니다.");
    } catch {
      setNotice("시나리오를 저장하지 못했습니다.");
    }
  };

  const recordRun = (completed: Scenario, status: "passed" | "failed") =>
    setRunHistory((history) => {
      const nextHistory = [
        {
          id: `${Date.now()}`,
          scenario: completed,
          status,
          ranAt: new Date().toISOString(),
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

  const beginRuns = (scenarios: Scenario[]) => {
    const toRun = scenarios.length ? scenarios : [scenario];
    const sequence = ++runSequence.current;
    setRoute("run");
    setRunning(true);
    runCancelled.current = false;
    setRunningScenario(toRun[0]);
    setRunStartedAt(Date.now());
    setElapsedSeconds(0);
    setPreviewImage("");
    setRunProgress({ current: 0, total: toRun[0].steps.length, step: "" });
    setRunLog([`${toRun.length}개 시나리오 실행을 시작했습니다.`]);
    void (async () => {
      for (const [index, runScenario] of toRun.entries()) {
        if (runCancelled.current || sequence !== runSequence.current) break;
        setRunningScenario(runScenario);
        setRunStartedAt(Date.now());
        setElapsedSeconds(0);
        setRunProgress({ current: 0, total: runScenario.steps.length, step: "" });
        setRunLog((logs) => [
          ...logs,
          `[${index + 1}/${toRun.length}] ${runScenario.title} 실행 시작`,
        ]);
        try {
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
          if (result.status === "passed" || result.status === "failed")
            recordRun(runScenario, result.status);
          if (result.status === "cancelled") break;
        } catch {
          setRunLog((logs) => [
            ...logs,
            `[${index + 1}/${toRun.length}] ${runScenario.title} 실행 실패`,
          ]);
        }
      }
      await window.electronAPI.finishQaWorker(String(sequence));
      if (sequence === runSequence.current) setRunning(false);
    })();
  };

  const beginRun = (toRun = scenario) => beginRuns([toRun]);

  const placeMarker = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = scenario.steps.length;
    setPendingMarker({
      id: String(index + 1),
      action: "click",
      target: "",
      connected: true,
      x: Math.round(((event.clientX - bounds.left) / bounds.width) * 1000) / 10,
      y: Math.round(((event.clientY - bounds.top) / bounds.height) * 1000) / 10,
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
      setNotice("시나리오를 저장했습니다.");
    } catch {
      setNotice("시나리오를 저장하지 못했습니다.");
    } finally {
      setSaveBeforeReturning(false);
      setEditorMode("text");
    }
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
    const targetIndex = scenario.steps.findIndex((step) => step.id === targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;

    const reordered = [...scenario.steps];
    const [draggedStep] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, draggedStep);
    const selectedStep = scenario.steps.find((step) => step.id === selectedId);
    updateSteps(reordered);
    if (selectedStep) setSelectedId(String(reordered.indexOf(selectedStep) + 1));
  };

  return (
    <main
      className={`workspace${route === "editor" && editorMode === "marker" ? " screen-extract-workspace" : ""}`}
    >
      <section className="content">
        {route === "scenarios" && (
          <DashboardPage
            history={runHistory}
            summary={runSummary}
            onEdit={(item) => {
              setScenario(item);
              setEditorMode("marker");
              setRoute("editor");
            }}
            onQuickStart={beginRun}
            onOpenRun={() => setRoute("run")}
          />
        )}
        {route === "editor" && (
          <ScenarioEditorPage
            mode={editorMode}
            scenario={scenario}
            sourceMarkdown={sourceMarkdown}
            scenarioFilePath={scenarioFilePath}
            previews={previews}
            notice={notice}
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
            onImport={() => void importScenario()}
            onExport={() => void saveScenarioFile()}
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
        {route === "run" && (
          <RunPage
            scenario={running ? runningScenario : executableScenario}
            scenarioCount={executableScenarios.length}
            running={running}
            manual={manual}
            runLog={runLog}
            runProgress={runProgress}
            elapsedSeconds={elapsedSeconds}
            runStartedAt={runStartedAt}
            livePreview={livePreview}
            previewImage={previewImage}
            onRun={() => beginRuns(executableScenarios)}
            onImport={() => void importScenario()}
            onCancel={() => {
              runCancelled.current = true;
              runSequence.current += 1;
              void window.electronAPI.cancelQa();
              setRunning(false);
            }}
            onLivePreviewChange={setLivePreview}
          />
        )}
        {failureVideoPath && (
          <button
            className="button button-secondary"
            onClick={() =>
              void window.electronAPI.openFailureVideo(failureVideoPath)
            }
          >
            실패 실행 영상 위치 열기
          </button>
        )}
      </section>
      <BottomNavigation route={route} onNavigate={setRoute} />
      {saveBeforeReturning && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="save-scenario-title">
          <div className="manual-modal">
            <h2 id="save-scenario-title">시나리오를 저장할까요?</h2>
            <p>화면에서 수정한 실행 단계를 Markdown 시나리오에 반영합니다.</p>
            <div className="modal-actions">
              <button onClick={() => setSaveBeforeReturning(false)}>취소</button>
              <button
                onClick={() => {
                  setSaveBeforeReturning(false);
                  setEditorMode("text");
                }}
              >
                저장하지 않고 돌아가기
              </button>
              <button className="button button-primary" onClick={() => void saveMarkerEditsAndReturn()}>
                저장 후 돌아가기
              </button>
            </div>
          </div>
        </div>
      )}
      {manual && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="manual-modal">
            <h2>수동 입력이 필요합니다</h2>
            <p>{manual.prompt || `${manual.target}를 입력해 주세요.`}</p>
            <input
              autoFocus
              type={manualValueVisible ? "text" : "password"}
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
            />
            <label className="manual-visibility-toggle">
              <input
                type="checkbox"
                checked={manualValueVisible}
                onChange={(event) =>
                  setManualValueVisible(event.target.checked)
                }
              />{" "}
              입력값 표시
            </label>
            <div className="modal-actions">
              <button onClick={() => void window.electronAPI.cancelQa()}>
                취소
              </button>
              <button
                onClick={() => {
                  void window.electronAPI.submitManualInput(manualValue);
                  setManual(null);
                }}
              >
                입력 후 계속
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
