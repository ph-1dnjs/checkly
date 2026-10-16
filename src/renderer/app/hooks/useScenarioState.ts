import { separateUploadPaths, restoreUploadPaths } from "../../shared/model/scenario-upload-paths";
import type { WebScenarioRecord } from "../../../app/ipc/web-scenario/types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  markerColor,
  parseMarkdown,
  splitScenarioBlocks,
  emptyScenario,
  type Action,
  type MarkerPositionStore,
  type Route,
  type Scenario,
  type Step,
} from "../../shared/model/scenario";

import {
  applyEditableValue,
  editableValueDefault,
  uniqueScenarioTitle,
  EDITABLE_VALUE_KIND,
} from "../../shared/model/scenario-duplication";

const initialMarkdown = "";
const isUuid = (id: string) => /^[a-f0-9-]{36}$/i.test(id);
const identifyMarkdown = (markdown: string, previous: Scenario[] = []): string => {
  const parsed = parseMarkdown(markdown);
  return splitScenarioBlocks(markdown).map((block, index) => {
    const item = parsed[index];
    const prior = previous.find(scenario => scenario.id === item.id) ?? previous[index];
    const id = isUuid(item.id) ? item.id : prior && isUuid(prior.id) ? prior.id : crypto.randomUUID();
    const code = item.code ?? prior?.code ?? `TC_${index + 1}`;
    let stepIndex = 0;
    const lines = block.trim().split("\n").filter(line => !/^\s*(id|code):/.test(line));
    lines.splice(1, 0, `id: ${id}`, `code: ${code}`);
    return lines.map(line => {
      if (!/^(Given|When|Then|And|But|If)\s+/i.test(line.trim())) return line;
      const step = item.steps[stepIndex];
      const stepId = step.databaseId ?? prior?.steps[stepIndex]?.databaseId ?? crypto.randomUUID();
      stepIndex += 1;
      return `${line.replace(/\s*<!-- step:[a-f0-9-]{36} -->/, "")} <!-- step:${stepId} -->`;
    }).join("\n");
  }).join("\n\n");
};
const positionKey = (scenario: Scenario) =>
  scenario.id;
const applyPositions = (
  scenario: Scenario,
  store: MarkerPositionStore,
): Scenario => {
  const positions = [...(store[positionKey(scenario)] ?? store[`${scenario.title}\n${scenario.url}`] ?? [])];
  return {
    ...scenario,
    steps: scenario.steps.map((step) => {
      const positionIndex = positions.findIndex(
        (item) =>
          (item.databaseId && step.databaseId ? item.databaseId === step.databaseId :
          item.action === step.action &&
          item.target === step.target &&
          item.value === step.value &&
          item.prompt === step.prompt &&
          item.condition === step.condition &&
          item.waitSeconds === step.waitSeconds &&
          (item.occurrence ?? 1) === (step.occurrence ?? 1)),
      );
      const position = positionIndex < 0 ? undefined : positions.splice(positionIndex, 1)[0];
      return position
        ? {
            ...step,
            markerViewport: position.markerViewport,
            markerPageUrl: position.markerPageUrl,
            occurrence: position.occurrence,
            x: position.x,
            y: position.y,
            color: position.color,
          }
        : step;
    }),
  };
};
const serializePositions = (store: MarkerPositionStore): string => JSON.stringify(
  Object.fromEntries(Object.entries(store).sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => [key,
    items.map(item => ({ databaseId: item.databaseId, markerViewport: item.markerViewport, markerPageUrl: item.markerPageUrl, action: item.action, target: item.target, value: item.value,
      prompt: item.prompt, condition: item.condition, waitSeconds: item.waitSeconds,
      occurrence: item.occurrence, x: item.x, y: item.y, color: item.color })),
  ])),
);
const scenarioToMarkdown = (scenario: Scenario): string =>
  [
    `# 시나리오: ${scenario.title}`,
    ...(isUuid(scenario.id) ? [`id: ${scenario.id}`] : []),
    ...(scenario.code ? [`code: ${scenario.code}`] : []),
    `url: ${scenario.url}`,
    ...(scenario.tag ? [`tag: ${scenario.tag}`] : []),
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
      return `${prefix} ${step.condition ? `화면에 \`${step.condition}\`가 있는 경우 ` : ""}${action}${step.waitSeconds && step.action !== "click" && step.action !== "expectText" ? ` [대기 ${step.waitSeconds}초]` : ""}${step.databaseId ? ` <!-- step:${step.databaseId} -->` : ""}`;
    }),
  ].join("\n");
const replaceScenarioMarkdown = (
  sourceMarkdown: string,
  scenario: Scenario,
): string => {
  const blocks = splitScenarioBlocks(sourceMarkdown);
  const index = parseMarkdown(sourceMarkdown).findIndex(
    (item) =>
      item.id === scenario.id ||
      (item.title === scenario.title && item.url === scenario.url),
  );
  if (index < 0) return sourceMarkdown;
  blocks[index] = scenarioToMarkdown(scenario);
  return blocks.join("\n\n").trim();
};

type UseScenarioStateOptions = {
  projectId?: string;
  baseUrl: string;
  route: Route;
  showToast: (message: string) => void;
};

export const useScenarioState = ({
  projectId,
  baseUrl,
  route,
  showToast,
}: UseScenarioStateOptions) => {
  const enabled = Boolean(projectId);
  const [scenario, setScenario] = useState(emptyScenario);
  const [sourceMarkdown, setSourceMarkdown] = useState(initialMarkdown);
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown);
  const [markerScenarioId, setMarkerScenarioId] = useState("");
  const [records, setRecords] = useState<WebScenarioRecord[]>([]);
  const [activeRecord, setActiveRecord] = useState<WebScenarioRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [savedPositions, setSavedPositions] = useState("{}");
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
      steps: steps.map((step, index) => ({ ...step, databaseId: step.databaseId ?? crypto.randomUUID(), id: String(index + 1) })),
    }));

  const uploadKey = (id: string) => `web-scenario-uploads:${projectId}:${id}`;
  const readRecords = async () => (await window.electronAPI.webScenarios.list()).map(record => {
    const paths = JSON.parse(localStorage.getItem(uploadKey(record.id)) ?? "[]");
    return restoreUploadPaths(record, paths);
  });
  const reportError = (error: unknown) => showToast(error instanceof Error ? error.message : "시나리오 요청을 처리하지 못했습니다.");
  const refreshRecords = async (reloadActive = false) => {
    if (!enabled || saving.current) return;
    setLoading(true);
    try {
      const items = await readRecords();
      setRecords(items);
      if (reloadActive && activeRecord) {
        const record = items.find(item => item.id === activeRecord.id);
        if (record) applyRecord(record);
        else clearRecord();
      }
    }
    catch (error) { reportError(error); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    void readRecords().then(items => {
      if (alive) setRecords(items);
    }).catch(error => { if (alive) reportError(error); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [enabled]);

  const currentPositions = useMemo(() => ({
    ...positionStore,
    ...(scenario.title ? { [positionKey(scenario)]: scenario.steps.flatMap(step =>
      step.x === undefined || step.y === undefined ? [] : [{
        databaseId: step.databaseId, markerViewport: step.markerViewport, markerPageUrl: step.markerPageUrl,
        action: step.action, target: step.target, value: step.value,
        prompt: step.prompt, condition: step.condition, waitSeconds: step.waitSeconds,
        occurrence: step.occurrence, x: step.x, y: step.y, color: step.color,
      }]) } : {}),
  }), [positionStore, scenario]);

  useEffect(() => {
    if (route !== "editor" || editorMode !== "marker" || !baseUrl) return;
    let url: string;
    try { url = new URL(scenario.url || "/", baseUrl).href; } catch { return; }
    let alive = true;
    const inspected = scenario;
    void window.electronAPI.inspectScenario({ ...inspected, url }).then(matches => {
      if (!alive) return;
      setScenario(current => current !== inspected ? current : ({ ...current,
        steps: current.steps.map(step => ({ ...step, connected: matches.some(match => match.id === step.id && match.connected) })),
      }));
    }).catch(() => { if (alive) showToast("대상 페이지를 확인하지 못했습니다."); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, editorMode, baseUrl]);

  const previews = useMemo(
    () => parseMarkdown(sourceMarkdown),
    [sourceMarkdown],
  );
  const executableScenario = useMemo(() => {
    const savedScenario = parseMarkdown(sourceMarkdown).find(
      (item) => item.id === scenario.id,
    );
    return savedScenario
      ? applyPositions(savedScenario, currentPositions)
      : scenario;
  }, [currentPositions, scenario, sourceMarkdown]);
  const executableScenarios = useMemo(
    () => previews.map((item) => applyPositions(item, currentPositions)),
    [currentPositions, previews],
  );

  const markerDialog = pendingMarker ?? editingMarker;

  const updateSource = (markdown: string) => {
    setPositionStore(currentPositions);
    setSourceMarkdown(markdown);
    const next = parseMarkdown(markdown)[0];
    if (next) {
      const positioned = applyPositions(next, currentPositions);
      setScenario(positioned);
      setMarkerScenarioId(positioned.id);
      setSelectedId(positioned.steps[0]?.id ?? "");
    }
  };

  const openRecord = (id: string) => {
    if (saving.current) return;
    const record = records.find(item => item.id === id);
    if (!record) return;
    applyRecord(record);
  };
  const applyRecord = (record: WebScenarioRecord) => {
    const original = JSON.parse(record.positions) as MarkerPositionStore;
    const parsed = parseMarkdown(record.markdown);
    const store = Object.fromEntries(parsed.map(item => [item.id,
      applyPositions(item, original).steps.filter(step => step.x !== undefined && step.y !== undefined),
    ]));
    const first = parsed[0] ?? emptyScenario;
    setActiveRecord(record);
    setSourceMarkdown(record.markdown);
    setSavedMarkdown(record.markdown);
    setPositionStore(store);
    setSavedPositions(serializePositions(store));
    setScenario(applyPositions(first, store));
    setMarkerScenarioId(first.id);
    setSelectedId(first.steps[0]?.id ?? "");
    setEditorMode("text");
    closeMarkerDialog();
    setIsAddingMarker(false);
  };
  const newRecord = () => {
    if (saving.current) return;
    setActiveRecord(null);
    setPositionStore({});
    setSavedPositions("{}");
    setSavedMarkdown("");
    const markdown = identifyMarkdown("# 시나리오: 새 시나리오\nurl: /\n\n");
    setSourceMarkdown(markdown);
    const first = parseMarkdown(markdown)[0];
    setScenario(first);
    setMarkerScenarioId(first.id);
    setSelectedId("");
    setIsAddingMarker(false);
    setEditorMode("text");
    closeMarkerDialog();
  };
  const saveRecord = async (markdown = editorMode === "marker" ? replaceScenarioMarkdown(sourceMarkdown, scenario) : sourceMarkdown) => {
    if (!enabled || saving.current || loading) return false;
    const parsed = parseMarkdown(markdown);
    if (!parsed.length) { showToast("저장할 시나리오를 작성하세요."); return false; }
    markdown = identifyMarkdown(markdown, previews);
    const identified = parseMarkdown(markdown);
    const positions = serializePositions(Object.fromEntries(identified.map((item, index) => [positionKey(item), currentPositions[positionKey(parsed[index])] ?? []])));
    saving.current = true;
    setBusy(true);
    try {
      const shared = separateUploadPaths(markdown, positions);
      const saved = await window.electronAPI.webScenarios.save({
        id: activeRecord?.id, expectedUpdatedAt: activeRecord?.updatedAt,
        title: parsed[0].title, markdown: shared.markdown, positions: shared.positions,
      });
      const record = restoreUploadPaths(saved, shared.paths);
      setActiveRecord(record);
      localStorage.setItem(uploadKey(saved.id), JSON.stringify(shared.paths));
      setRecords(items => [record, ...items.filter(item => item.id !== record.id)]);
      setSourceMarkdown(current => current === sourceMarkdown ? record.markdown : current);
      setSavedMarkdown(record.markdown);
      setSavedPositions(serializePositions(JSON.parse(record.positions)));
      setPositionStore(JSON.parse(record.positions));
      const savedScenarios = parseMarkdown(record.markdown);
      const currentScenario = savedScenarios.find(item => item.id === scenario.id) ?? savedScenarios[parsed.findIndex(item => item.id === scenario.id)] ?? savedScenarios[0];
      if (currentScenario) {
        setScenario(applyPositions(currentScenario, JSON.parse(record.positions)));
        setMarkerScenarioId(currentScenario.id);
      }
      showToast("시나리오를 저장했습니다.");
      return true;
    } catch (error) { reportError(error); return false; }
    finally { saving.current = false; setBusy(false); }
  };
  const clearRecord = () => {
    setActiveRecord(null);
    setScenario(emptyScenario);
    setSourceMarkdown("");
    setSavedMarkdown("");
    setPositionStore({});
    setSavedPositions("{}");
    setEditorMode("text");
    setMarkerScenarioId("");
    setSelectedId("");
    closeMarkerDialog();
  };
  const deleteRecord = async () => {
    if (!activeRecord || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await window.electronAPI.webScenarios.remove(activeRecord.id, activeRecord.updatedAt);
      localStorage.removeItem(uploadKey(activeRecord.id));
      setRecords(items => items.filter(item => item.id !== activeRecord.id));
      clearRecord();
      showToast("시나리오를 삭제했습니다.");
    } catch (error) { reportError(error); }
    finally { saving.current = false; setBusy(false); }
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
        : applyPositions(item, currentPositions),
    );
    setSourceMarkdown(markdown);
    return scenarios;
  };

  const placeMarker = ({
    x,
    y,
    target,
    action,
    markerViewport,
    markerPageUrl,
  }: {
    x: number;
    y: number;
    target: string;
    action: Action;
    markerViewport?: Step["markerViewport"];
    markerPageUrl?: string;
  }) => {
    const index = scenario.steps.length;
    setPendingMarker({
      id: String(index + 1),
      databaseId: crypto.randomUUID(),
      markerViewport,
      markerPageUrl,
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
    if (await saveRecord(markdown)) {
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
    const positioned = applyPositions(nextScenario, currentPositions);
    setPositionStore(currentPositions);
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

  // 원본의 입력값·확인값을 바로 바꿔 새 시나리오(들)를 복제한다.
  const duplicateScenario = (
    scenarioId: string,
    nameTemplate: string,
    cases: Array<Record<string, string>>,
  ) => {
    const target = previews.find((item) => item.id === scenarioId);
    if (!target || !cases.length) return;
    const defaults: Record<string, string> = {};
    target.steps.forEach((step) => {
      const kind = EDITABLE_VALUE_KIND[step.action];
      if (kind) defaults[step.id] = editableValueDefault(step, kind);
    });
    const usedTitles = previews.map((item) => item.title);
    const blocks = cases.map((values) => {
      const title = uniqueScenarioTitle(
        nameTemplate.trim() || `${target.title} 복제`,
        usedTitles,
      );
      usedTitles.push(title);
      const steps = target.steps.map((step) => {
        const kind = EDITABLE_VALUE_KIND[step.action];
        if (!kind) return { ...step, databaseId: crypto.randomUUID() };
        const value = values[step.id]?.trim() || defaults[step.id] || "";
        return { ...applyEditableValue(step, kind, value), databaseId: crypto.randomUUID() };
      });
      return scenarioToMarkdown({
        ...target,
        id: crypto.randomUUID(),
        code: `TC_${usedTitles.length}`,
        title,
        steps,
      });
    });
    updateSource([sourceMarkdown.trim(), ...blocks].filter(Boolean).join("\n\n"));
    showToast(`시나리오 ${blocks.length}개를 템플릿으로 복제했습니다.`);
  };

  return {
    scenario,
    setScenario,
    sourceMarkdown,
    isDirty: sourceMarkdown !== savedMarkdown || (editorMode === "marker" && replaceScenarioMarkdown(sourceMarkdown, scenario) !== savedMarkdown) || serializePositions(Object.fromEntries(parseMarkdown(sourceMarkdown).map(item => [positionKey(item), currentPositions[positionKey(item)] ?? []]))) !== savedPositions,
    records, activeRecord, loading, busy, refreshRecords, openRecord, newRecord, saveRecord, deleteRecord,
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
    commitEditorRunSnapshot,
    placeMarker,
    updateMarker,
    closeMarkerDialog,
    completeMarker,
    saveMarkerEditsAndReturn,
    selectMarkerScenario,
    reorderSteps,
    duplicateScenario,
  };
};

export type UseScenarioStateResult = ReturnType<typeof useScenarioState>;
