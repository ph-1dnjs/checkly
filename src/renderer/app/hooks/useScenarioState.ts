import { useEffect, useMemo, useState } from "react";
import {
  markerColor,
  parseMarkdown,
  emptyScenario,
  type Action,
  type MarkerPositionStore,
  type Route,
  type Scenario,
  type Step,
} from "../../shared/model/scenario";

const initialMarkdown = "";
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

type UseScenarioStateOptions = {
  route: Route;
  showToast: (message: string) => void;
};

export const useScenarioState = ({
  route,
  showToast,
}: UseScenarioStateOptions) => {
  const [scenario, setScenario] = useState(emptyScenario);
  const [sourceMarkdown, setSourceMarkdown] = useState(initialMarkdown);
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown);
  const [markerScenarioId, setMarkerScenarioId] = useState("");
  const [scenarioFilePath, setScenarioFilePath] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"text" | "marker">("text");
  const [selectedId, setSelectedId] = useState("3");
  const [editingMarker, setEditingMarker] = useState<Step | null>(null);
  const [pendingMarker, setPendingMarker] = useState<Step | null>(null);
  const [isAddingMarker, setIsAddingMarker] = useState(false);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [saveBeforeReturning, setSaveBeforeReturning] = useState(false);
  const [positionStore, setPositionStore] = useState<MarkerPositionStore>({});

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
      .catch(() => showToast("저장된 시나리오를 불러오지 못했습니다."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      .catch(() => showToast("마커 위치를 저장하지 못했습니다."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionStore]);

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
      .catch(() => showToast("대상 페이지를 확인하지 못했습니다."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    showToast("시나리오를 불러왔습니다.");
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
      showToast("시나리오를 저장했습니다.");
    } catch {
      showToast("시나리오를 저장하지 못했습니다.");
    }
  };

  // 실행 화면으로 넘어가기 직전 편집기 상태를 Markdown에 반영하고,
  // 지금 편집 중인 시나리오를 포함한 실행 가능한 시나리오 배열을 만든다.
  const commitEditorRunSnapshot = (): Scenario[] => {
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
    return scenarios;
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

  const closeMarkerDialog = () => {
    setPendingMarker(null);
    setEditingMarker(null);
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
      showToast("시나리오를 저장했습니다.");
    } catch {
      showToast("시나리오를 저장하지 못했습니다.");
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

  return {
    scenario,
    setScenario,
    sourceMarkdown,
    isDirty: sourceMarkdown !== savedMarkdown,
    scenarioFilePath,
    markerScenarioId,
    editorMode,
    setEditorMode,
    selectedId,
    setSelectedId,
    editingMarker,
    setEditingMarker,
    pendingMarker,
    isAddingMarker,
    setIsAddingMarker,
    markersVisible,
    setMarkersVisible,
    saveBeforeReturning,
    setSaveBeforeReturning,
    previews,
    executableScenario,
    executableScenarios,
    markerDialog,
    updateSteps,
    updateSource,
    importScenario,
    saveScenarioFile,
    commitEditorRunSnapshot,
    placeMarker,
    updateMarker,
    closeMarkerDialog,
    completeMarker,
    saveMarkerEditsAndReturn,
    selectMarkerScenario,
    reorderSteps,
  };
};

export type UseScenarioStateResult = ReturnType<typeof useScenarioState>;
