import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Button } from "../shared/ui/Button";
import { Popover } from "../shared/ui/Popover";
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
  // 편집 액션
  isDirty: boolean;
  onSave: () => Promise<boolean>;
  busy: boolean;
  canDelete: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onImportMarkdown: (markdown: string) => void;
  // 실행 액션
  keepSession: boolean;
  onKeepSessionChange: (value: boolean) => void;
  sessionActive: boolean;
  onEndSession: () => void;
  livePreview: boolean;
  onLivePreviewChange: (value: boolean) => void;
  /** 헤더 오른쪽 끝의 실행 환경 선택 */
  environment: ReactNode;
};

const SAVED_FLASH_MS = 1400;

/** PageLayout 헤더의 extra: 편집/실행 탭 · 하위 화면 · 화면별 액션 · 실행 환경 */
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
  onDuplicate,
  onImportMarkdown,
  keepSession,
  onKeepSessionChange,
  sessionActive,
  onEndSession,
  livePreview,
  onLivePreviewChange,
  environment,
}: Props) => {
  const editTab = route === "editor";
  const live = running || awaiting;
  const [savedFlash, setSavedFlash] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);
  const moreRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !moreRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [moreOpen]);

  const runSave = async (save: () => Promise<boolean>) => {
    if (!(await save())) return;
    setSavedFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS);
  };
  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void file.text().then(onImportMarkdown);
  };
  const menuAction = (action: () => void) => () => {
    setMoreOpen(false);
    action();
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
  const saveWord = busy ? "저장 중…" : savedFlash ? "저장됨" : "저장";

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
        {editTab && (
          <>
            {isDirty && (
              <span className="ws-unsaved" title="마지막 저장 이후 변경됨">
                <i aria-hidden="true" />
                저장 안 됨
              </span>
            )}
            <Button
              variant="primary"
              className="ws-save-main"
              aria-label={saveWord}
              title="저장 (⌘S)"
              disabled={busy}
              onClick={() => void runSave(onSave)}
            >
              {saveWord}
              <kbd aria-hidden="true">⌘S</kbd>
            </Button>
            <div className="ws-more" ref={moreRef}>
              <Button
                variant="secondary"
                iconOnly
                aria-label="더보기"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <span className="msi" aria-hidden="true">more_horiz</span>
              </Button>
              {moreOpen && (
                <div className="ws-more-menu" role="menu" aria-label="문서 메뉴">
                  <Button role="menuitem" disabled={busy} onClick={menuAction(onDuplicate)}>
                    <span className="msi" aria-hidden="true">content_copy</span>
                    문서 복제
                  </Button>
                  <Button role="menuitem" disabled={busy} onClick={menuAction(() => fileRef.current?.click())}>
                    <span className="msi" aria-hidden="true">upload_file</span>
                    .md 불러오기
                  </Button>
                  <div className="ws-more-sep" role="separator" />
                  <Button role="menuitem" className="danger" disabled={busy || !canDelete} onClick={menuAction(onDelete)}>
                    <span className="msi" aria-hidden="true">delete</span>
                    문서 삭제
                  </Button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                hidden
                onChange={importFile}
              />
            </div>
          </>
        )}
        {!editTab && (
          <>
            <Button
              role="switch"
              aria-checked={keepSession}
              className="ws-session"
              title={
                running
                  ? "지금 실행 중인 브라우저를 그대로 유지 세션으로 사용합니다. 다음 실행부터 재인증을 건너뜁니다."
                  : "실행이 끝나도 브라우저 세션(쿠키)을 유지해, 다시 실행할 때 재인증을 건너뜁니다."
              }
              onClick={() => onKeepSessionChange(!keepSession)}
            >
              <span className="ws-switch" aria-hidden="true"><i /></span>
              세션 유지
            </Button>
            {sessionActive && (
              <Button variant="secondary" disabled={running} onClick={onEndSession}>
                세션 종료
              </Button>
            )}
            <Popover
              label="브라우저 · 동시 실행 수"
              triggerText={<>Chromium · 1w<span className="msi" aria-hidden="true">expand_more</span></>}
              className="run-settings-menu ws-wide"
              triggerClassName="ws-select-trigger mono"
              panelClassName="run-settings-popover"
            >
              <div className="run-settings-group">
                <p>BROWSER</p>
                <div className="setting-choice">
                  <Button className="selected">Chromium</Button>
                  <Button>WebKit</Button>
                  <Button>Firefox</Button>
                </div>
              </div>
              <div className="run-settings-group">
                <p>WORKERS</p>
                <div className="setting-choice">
                  <Button className="selected">1</Button>
                  <Button>2</Button>
                  <Button>4</Button>
                </div>
              </div>
              <label className="run-settings-toggle">
                <input
                  type="checkbox"
                  checked={livePreview}
                  onChange={(event) => onLivePreviewChange(event.target.checked)}
                  disabled={running}
                />
                실행 화면 표시
              </label>
            </Popover>
          </>
        )}
        <span className="ws-actions-sep" aria-hidden="true" />
        {environment}
      </div>
    </>
  );
};
