import { useEffect, useMemo, useState } from "react";
import { actionText, parseMarkdown, type Scenario } from "../../shared/model/scenario";

type FileEntry = { name: string; path: string; updatedAt: string };
type Picked = { fileName: string; filePath: string; scenario: Scenario };

type Props = {
  onOpenEditor: () => void;
  onRun: (scenarios: Scenario[]) => void;
};

const keyOf = (filePath: string, scenario: Scenario) => `${filePath}::${scenario.id}`;

export const ScenarioPickerPage = ({ onOpenEditor, onRun }: Props) => {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileCache, setFileCache] = useState<Record<string, Scenario[]>>({});
  const [loadingFolder, setLoadingFolder] = useState(true);
  const [pickedKeys, setPickedKeys] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const refreshFolder = async () => {
    setLoadingFolder(true);
    try {
      const result = await window.electronAPI.listScenarioFolder();
      setFolderPath(result.folderPath);
      setFiles(result.files);
      setActiveFilePath((current) =>
        current && result.files.some((file) => file.path === current)
          ? current
          : (result.files[0]?.path ?? null),
      );
    } finally {
      setLoadingFolder(false);
    }
  };

  useEffect(() => {
    void refreshFolder();
  }, []);

  useEffect(() => {
    if (!activeFilePath || fileCache[activeFilePath]) return;
    void window.electronAPI.readScenarioFile(activeFilePath).then((markdown) => {
      if (markdown === null) return;
      setFileCache((cache) => ({ ...cache, [activeFilePath]: parseMarkdown(markdown) }));
    });
  }, [activeFilePath, fileCache]);

  const chooseFolder = async () => {
    const result = await window.electronAPI.chooseScenarioFolder();
    setFolderPath(result.folderPath);
    setFiles(result.files);
    setFileCache({});
    setActiveFilePath(result.files[0]?.path ?? null);
  };

  const activeFile = files.find((file) => file.path === activeFilePath) ?? null;
  const activeScenarios = activeFilePath ? (fileCache[activeFilePath] ?? []) : [];

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
  const flowDone1 = hasFiles;
  const flowDone2 = hasFiles;
  const flowDone3 = picked.length > 0;
  const flowDone4 = picked.length > 0;

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
            <button className="button button-primary" onClick={() => void chooseFolder()}>
              폴더 선택
            </button>
            {folderPath && (
              <button className="button button-secondary" onClick={() => void refreshFolder()}>
                다시 불러오기
              </button>
            )}
            <button className="button button-secondary" onClick={onOpenEditor}>
              편집기 열기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="picker">
      <header className="picker-header">
        <div className="picker-title">시나리오 실행</div>
        <div className="picker-flow" aria-label="실행 단계">
          <span className={flowDone1 ? "done" : ""}>
            <i>1</i>파일 불러오기
          </span>
          <i className="picker-flow-line" />
          <span className={flowDone2 ? "done" : ""}>
            <i>2</i>시나리오 확인
          </span>
          <i className="picker-flow-line" />
          <span className={flowDone3 ? "done" : ""}>
            <i>3</i>실행할 시나리오 선택
          </span>
          <i className="picker-flow-line" />
          <span className={flowDone4 ? "done" : ""}>
            <i>4</i>실행
          </span>
        </div>
        <div className="picker-actions">
          <button
            className="button button-secondary"
            onClick={() => void refreshFolder()}
          >
            파일 다시 불러오기
          </button>
          <button className="button button-secondary" onClick={onOpenEditor}>
            편집기 열기
          </button>
        </div>
      </header>

      <div className="picker-layout">
        <aside className="picker-files">
          <div className="picker-col-label">
            <span>FILES</span>
            <button onClick={() => void chooseFolder()}>폴더 변경</button>
          </div>
          {files.map((file) => {
            const n = (fileCache[file.path] ?? []).filter((scenario) =>
              pickedKeys.has(keyOf(file.path, scenario)),
            ).length;
            return (
              <button
                key={file.path}
                className={file.path === activeFilePath ? "active" : ""}
                onClick={() => setActiveFilePath(file.path)}
              >
                <span className="msi">description</span>
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {fileCache[file.path]
                      ? `${fileCache[file.path].length}개 시나리오`
                      : "…"}{" "}
                    · {new Date(file.updatedAt).toLocaleDateString("ko-KR")}
                  </small>
                </div>
                {n > 0 && <em>{n} 선택</em>}
              </button>
            );
          })}
        </aside>

        <section className="picker-scenarios">
          {activeFile ? (
            <>
              <div className="picker-panel-heading">
                <div>
                  <p>{activeFile.name}</p>
                  <strong>
                    {activeScenarios.length} scenario
                    {activeScenarios.length === 1 ? "" : "s"} ·{" "}
                    {activeScenarios.reduce((total, s) => total + s.steps.length, 0)} steps
                  </strong>
                </div>
              </div>
              {activeScenarios.map((scenario) => {
                const key = keyOf(activeFilePath!, scenario);
                const isPicked = pickedKeys.has(key);
                const isOpen = expandedKeys.has(key);
                const unlinked = scenario.steps.filter((step) => !step.connected).length;
                return (
                  <div className={`picker-scenario${isPicked ? " picked" : ""}`} key={key}>
                    <div className="picker-scenario-row">
                      <button
                        className="picker-scenario-main"
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
                      </button>
                      <button className="picker-expand" onClick={() => toggleExpand(key)}>
                        {isOpen ? "▾" : "▸"} 단계
                      </button>
                      <button
                        className="picker-run-only"
                        title="이 시나리오만 실행"
                        onClick={() => runOnly(activeFilePath!, scenario)}
                      >
                        <span className="msi">play_arrow</span>
                      </button>
                    </div>
                    {isOpen && (
                      <ol className="picker-steps">
                        {scenario.steps.map((step, index) => (
                          <li key={step.id}>
                            <b>{String(index + 1).padStart(2, "0")}</b>
                            <span className="picker-op">{step.action.toUpperCase()}</span>
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
            <span>SELECTED · 실행 대상</span>
            {picked.length > 0 && (
              <button onClick={() => setPickedKeys(new Set())}>비우기</button>
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
                      <button
                        title="선택 해제"
                        onClick={() => togglePick(item.filePath, item.scenario)}
                      >
                        ✕
                      </button>
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
            <button
              className="button button-primary"
              disabled={!picked.length}
              onClick={runPicked}
            >
              <span className="msi">play_arrow</span>
              {picked.length ? `${picked.length}개 시나리오 실행` : "시나리오를 선택하세요"}
            </button>
          </footer>
        </aside>
      </div>
    </div>
  );
};
