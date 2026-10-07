import { useMemo, useState } from "react";
import { actionText, type Scenario } from "../../shared/model/scenario";
import { ActionTag } from "../../shared/ui/ActionTag";
import { Button } from "../../shared/ui/Button";
import {
  pickKeyOf as keyOf,
  ScenarioFileList,
  type ScenarioFolderState,
} from "../../entities/scenario-folder";

type Picked = { fileName: string; filePath: string; scenario: Scenario };

type Props = {
  folder: ScenarioFolderState;
  onOpenEditor: () => void;
  onRun: (scenarios: Scenario[]) => void;
};

export const ScenarioPickerPage = ({ folder, onOpenEditor, onRun }: Props) => {
  const {
    folderPath,
    files,
    fileCache,
    loadingFolder,
    refreshFolder,
    chooseFolder,
    pickedKeys,
    setPickedKeys,
    pickedCountByFile,
  } = folder;
  const [selectedFilePath, setActiveFilePath] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const activeFilePath =
    selectedFilePath && files.some((file) => file.path === selectedFilePath)
      ? selectedFilePath
      : (files[0]?.path ?? null);

  const activeFile = files.find((file) => file.path === activeFilePath) ?? null;
  const activeScenarios = activeFilePath ? (fileCache[activeFilePath] ?? []) : [];
  const allActivePicked = activeScenarios.length > 0 && activeScenarios.every(
    (scenario) => pickedKeys.has(keyOf(activeFilePath!, scenario)),
  );
  const someActivePicked = activeScenarios.some(
    (scenario) => pickedKeys.has(keyOf(activeFilePath!, scenario)),
  );

  const togglePickAll = () => {
    if (!activeFilePath) return;
    setPickedKeys((keys) => {
      const next = new Set(keys);
      const allPicked = activeScenarios.every((scenario) => keys.has(keyOf(activeFilePath, scenario)));
      for (const scenario of activeScenarios) {
        const key = keyOf(activeFilePath, scenario);
        allPicked ? next.delete(key) : next.add(key);
      }
      return next;
    });
  };

  const togglePick = (filePath: string, scenario: Scenario) => {
    const key = keyOf(filePath, scenario);
    setPickedKeys((keys) => {
      const next = new Set(keys);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleExpand = (key: string) =>
    setExpandedKeys((keys) => {
      const next = new Set(keys);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const picked = useMemo(() => {
    const out: Picked[] = [];
    for (const file of files) {
      const scenarios = fileCache[file.path] ?? [];
      for (const scenario of scenarios) {
        if (pickedKeys.has(keyOf(file.path, scenario))) {
          out.push({ fileName: file.name, filePath: file.path, scenario });
        }
      }
    }
    return out;
  }, [files, fileCache, pickedKeys]);

  const pickedGroups = useMemo(() => {
    const groups = new Map<string, Picked[]>();
    for (const item of picked) {
      const list = groups.get(item.filePath) ?? [];
      list.push(item);
      groups.set(item.filePath, list);
    }
    return Array.from(groups.entries()).map(([filePath, items]) => ({
      filePath,
      fileName: items[0].fileName,
      items,
    }));
  }, [picked]);

  const totalSteps = picked.reduce((total, item) => total + item.scenario.steps.length, 0);
  const hasFiles = files.length > 0;

  const runOnly = (filePath: string, scenario: Scenario) => onRun([scenario]);
  const runPicked = () => onRun(picked.map((item) => item.scenario));

  if (loadingFolder) return <div className="picker" />;

  if (!folderPath || !hasFiles) {
    return (
      <div className="picker">
        <div className="picker-empty-state">
          <div className="picker-empty-title">
            {folderPath ? "폴더에 시나리오 파일이 없습니다" : "시나리오 폴더를 선택해 주세요"}
          </div>
          <div className="picker-empty-body">
            {folderPath
              ? `${folderPath} 폴더에 .md 시나리오 파일을 추가한 뒤 다시 불러오세요.`
              : "시나리오 markdown(.md) 파일이 들어있는 폴더를 선택하면 이 화면에서 파일과 시나리오를 확인하고 실행할 수 있습니다."}
          </div>
          <div className="picker-empty-actions">
            <Button variant="primary" onClick={() => void chooseFolder()}>
              폴더 선택
            </Button>
            {folderPath && (
              <Button variant="secondary" onClick={() => void refreshFolder()}>
                다시 불러오기
              </Button>
            )}
            <Button variant="secondary" onClick={onOpenEditor}>
              편집기 열기
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="picker">

      <div className="picker-layout">
        <ScenarioFileList
          files={files}
          fileCache={fileCache}
          activePath={activeFilePath}
          pickedCountByFile={pickedCountByFile}
          onSelect={setActiveFilePath}
          onChooseFolder={() => void chooseFolder()}
        />

        <section className="picker-scenarios">
          {activeFile ? (
            <>
              <div className="picker-panel-heading">
                <Button
                  className="picker-scenario-main"
                  role="checkbox"
                  aria-label="전체 선택"
                  aria-checked={allActivePicked ? true : someActivePicked ? "mixed" : false}
                  disabled={!activeScenarios.length}
                  onClick={togglePickAll}
                >
                  <span className={`picker-check${someActivePicked ? " on" : ""}`} aria-hidden="true">
                    {someActivePicked && <span className="msi">{allActivePicked ? "check" : "remove"}</span>}
                  </span>
                  <div>
                    <p>{activeFile.name}</p>
                    <strong>
                      {activeScenarios.length} scenario
                      {activeScenarios.length === 1 ? "" : "s"} ·{" "}
                      {activeScenarios.reduce((total, s) => total + s.steps.length, 0)} steps
                    </strong>
                  </div>
                </Button>
              </div>
              {activeScenarios.map((scenario) => {
                const key = keyOf(activeFilePath!, scenario);
                const isPicked = pickedKeys.has(key);
                const isOpen = expandedKeys.has(key);
                const unlinked = scenario.steps.filter((step) => !step.connected).length;
                return (
                  <div className={`picker-scenario${isPicked ? " picked" : ""}`} key={key}>
                    <div className="picker-scenario-row">
                      <Button
                        className="picker-scenario-main"
                        aria-pressed={isPicked}
                        onClick={() => togglePick(activeFilePath!, scenario)}
                      >
                        <span className={`picker-check${isPicked ? " on" : ""}`}>
                          {isPicked && <span className="msi">check</span>}
                        </span>
                        <div>
                          <div className="picker-scenario-name">
                            <span>{scenario.title}</span>
                            {scenario.tag && <em className="picker-tag">{scenario.tag}</em>}
                          </div>
                          <div className="picker-scenario-summary">
                            {scenario.steps.length}개 단계
                            {unlinked ? ` · 선택자 미연결 ${unlinked}` : ""}
                          </div>
                        </div>
                      </Button>
                      <Button className="picker-expand" onClick={() => toggleExpand(key)}>
                        {isOpen ? "▾" : "▸"} 단계
                      </Button>
                      <Button
                        className="picker-run-only"
                        title="이 시나리오만 실행"
                        onClick={() => runOnly(activeFilePath!, scenario)}
                      >
                        <span className="msi">play_arrow</span>
                      </Button>
                    </div>
                    {isOpen && (
                      <ol className="picker-steps">
                        {scenario.steps.map((step, index) => (
                          <li key={step.id}>
                            <b>{String(index + 1).padStart(2, "0")}</b>
                            <ActionTag action={step.action} className="picker-op" />
                            <span className="picker-target">{actionText(step)}</span>
                            <em className={step.connected ? "" : "unlinked"}>
                              {step.connected ? "linked" : "unlinked"}
                            </em>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="picker-empty">파일을 선택해 주세요.</div>
          )}
        </section>

        <aside className="picker-cart">
          <div className="picker-col-label">
            <span>실행 대상</span>
            {picked.length > 0 && (
              <Button onClick={() => setPickedKeys(new Set())}>비우기</Button>
            )}
          </div>
          <div className="picker-cart-body">
            {picked.length === 0 ? (
              <p className="picker-cart-empty">
                왼쪽에서 파일을 고르고, 실행할 시나리오를 선택하세요. 여러 파일에서 골라
                한 번에 실행할 수 있습니다.
              </p>
            ) : (
              pickedGroups.map((group) => (
                <div key={group.filePath}>
                  <div className="picker-cart-group">
                    <span>{group.fileName}</span>
                    <b>{group.items.length}</b>
                  </div>
                  {group.items.map((item, index) => (
                    <div className="picker-cart-item" key={keyOf(item.filePath, item.scenario)}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <span>{item.scenario.title}</span>
                      <i>{item.scenario.steps.length} steps</i>
                      <Button
                        title="선택 해제"
                        onClick={() => togglePick(item.filePath, item.scenario)}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
          <footer>
            <div className="picker-cart-stats">
              <div>
                <span>SCENARIOS</span>
                <strong>{picked.length}</strong>
              </div>
              <div>
                <span>STEPS</span>
                <strong>{totalSteps}</strong>
              </div>
            </div>
            <Button
              variant="primary"
              disabled={!picked.length}
              onClick={runPicked}
            >
              <span className="msi">play_arrow</span>
              {picked.length ? `${picked.length}개 시나리오 실행` : "시나리오를 선택하세요"}
            </Button>
          </footer>
        </aside>
      </div>
    </div>
  );
};
