import { useEffect, useRef, useState } from "react";
import { Button } from "../shared/ui/Button";
import type {
  ScenarioRunRoute,
  ScenarioWorkspaceRoute,
} from "../shared/model/scenario";

type EditorMode = "text" | "marker";

type Props = {
  route: ScenarioWorkspaceRoute;
  editorMode: EditorMode;
  lastRunRoute: ScenarioRunRoute;
  onNavigate: (route: ScenarioWorkspaceRoute) => void;
  onEditorModeChange: (mode: EditorMode) => void;
  // 실행 탭 상태
  running: boolean;
  awaiting: boolean;
  progressPercent: number;
  progressSteps: string;
  pickedCount: number;
  // 편집(텍스트) 액션
  isDirty: boolean;
  onSave: () => Promise<boolean>;
  onSaveAs: () => Promise<boolean>;
  onImport: () => void;
  // 대상 선택 액션
  onReloadFolder: () => void;
};

const SAVED_FLASH_MS = 1400;

export const ScenarioWorkspaceHeader = ({
  route,
  editorMode,
  lastRunRoute,
  onNavigate,
  onEditorModeChange,
  running,
  awaiting,
  progressPercent,
  progressSteps,
  pickedCount,
  isDirty,
  onSave,
  onSaveAs,
  onImport,
  onReloadFolder,
}: Props) => {
  const editTab = route === "editor";
  const live = running || awaiting;
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const saveRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  useEffect(() => {
    if (!saveMenuOpen) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !saveRef.current?.contains(event.target))
        setSaveMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSaveMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [saveMenuOpen]);

  const runSave = async (save: () => Promise<boolean>) => {
    setSaveMenuOpen(false);
    if (!(await save())) return;
    setSavedFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS);
  };

  const subs: Array<{ id: string; label: string; meta: string; on: boolean; go: () => void }> =
    editTab
      ? [
          {
            id: "text",
            label: "텍스트",
            meta: "",
            on: editorMode === "text",
            go: () => onEditorModeChange("text"),
          },
          {
            id: "marker",
            label: "화면 추출",
            meta: "",
            on: editorMode === "marker",
            go: () => onEditorModeChange("marker"),
          },
        ]
      : [
          {
            id: "picker",
            label: "대상 선택",
            meta: String(pickedCount),
            on: route === "picker",
            go: () => onNavigate("picker"),
          },
          {
            id: "run",
            label: "실행 현황",
            meta: live ? progressSteps : "",
            on: route === "run",
            go: () => onNavigate("run"),
          },
        ];

  return (
    <header className="ws-header">
      <div className="ws-title">
        <span className="msi" aria-hidden="true">fact_check</span>
        <span>시나리오</span>
      </div>
      <div className="ws-tabs" role="tablist" aria-label="시나리오 작업">
        <Button
          role="tab"
          aria-selected={editTab}
          className={`ws-tab${editTab ? " active" : ""}`}
          title="Markdown 작성 · 화면에서 마커 추출"
          onClick={() => onNavigate("editor")}
        >
          <span className="msi" aria-hidden="true">edit_note</span>
          <span>편집</span>
        </Button>
        <Button
          role="tab"
          aria-selected={!editTab}
          className={`ws-tab${editTab ? "" : " active"}`}
          title="실행 대상 선택 · 실행 현황"
          onClick={() => onNavigate(lastRunRoute)}
        >
          <span className="msi" aria-hidden="true">play_circle</span>
          <span>실행</span>
          {live && (
            <span className={`ws-tab-live${awaiting ? " waiting" : ""}`}>
              <i aria-hidden="true" />
              {awaiting ? "대기" : `${progressPercent}%`}
            </span>
          )}
        </Button>
      </div>
      <div className="ws-subs">
        <div className="ws-segment">
          {subs.map((sub) => (
            <Button
              key={sub.id}
              className={sub.on ? "active" : ""}
              aria-pressed={sub.on}
              onClick={sub.go}
            >
              {sub.label}
              {sub.meta && <span>{sub.meta}</span>}
            </Button>
          ))}
        </div>
      </div>
      <div className="ws-actions">
        {route === "editor" && editorMode === "text" && (
          <>
            {isDirty && <span className="ws-unsaved">UNSAVED</span>}
            <div className="ws-save" ref={saveRef}>
              <Button className="ws-save-main" onClick={() => void runSave(onSave)}>
                {savedFlash ? "저장됨" : "저장"}
              </Button>
              <Button
                className="ws-save-toggle"
                aria-label="저장 옵션"
                aria-haspopup="menu"
                aria-expanded={saveMenuOpen}
                onClick={() => setSaveMenuOpen((open) => !open)}
              >
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path
                    d="M2 3.5 5 6.5 8 3.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Button>
              {saveMenuOpen && (
                <div className="ws-save-menu" role="menu">
                  <Button role="menuitem" onClick={() => void runSave(onSaveAs)}>
                    새로 저장하기<span>⇧⌘S</span>
                  </Button>
                </div>
              )}
            </div>
            <Button className="ws-action" onClick={onImport}>
              불러오기
            </Button>
          </>
        )}
        {route === "picker" && (
          <>
            <Button className="ws-action" onClick={onReloadFolder}>
              불러오기
            </Button>
            <Button className="ws-action" onClick={() => onNavigate("editor")}>
              <span className="msi" aria-hidden="true">edit</span>
              편집
            </Button>
          </>
        )}
      </div>
    </header>
  );
};
