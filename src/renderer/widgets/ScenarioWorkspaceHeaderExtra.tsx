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
  busy: boolean;
  canDelete: boolean;
  onDelete: () => void;
  // 대상 선택 액션
  onRefresh: () => void;
};

const SAVED_FLASH_MS = 1400;

/** PageLayout 헤더의 extra: 편집/실행 탭 · 하위 화면 · 저장 액션 */
export const ScenarioWorkspaceHeaderExtra = ({
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
  busy,
  canDelete,
  onDelete,
  onRefresh,
}: Props) => {
  const editTab = route === "editor";
  const live = running || awaiting;
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const runSave = async (save: () => Promise<boolean>) => {
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
    <>
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
            <Button className="ws-save-main" disabled={busy} onClick={() => void runSave(onSave)}>
              {busy ? "저장 중…" : savedFlash ? "저장됨" : "저장"}
            </Button>
            <Button className="ws-action" disabled={busy || !canDelete} onClick={onDelete}>삭제</Button>
          </>
        )}
        {route === "picker" && (
          <>
            <Button className="ws-action" onClick={onRefresh}>
              새로고침
            </Button>
            <Button className="ws-action" onClick={() => onNavigate("editor")}>
              <span className="msi" aria-hidden="true">edit</span>
              편집
            </Button>
          </>
        )}
      </div>
    </>
  );
};
