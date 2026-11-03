import { resolveScenarioUrl, routePath } from "../../shared/model/scenario";
import { Fragment, useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import {
  actionText,
  type Action,
  type Scenario,
  type Step,
} from "../../shared/model/scenario";
import { ActionTag } from "../../shared/ui/ActionTag";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { DuplicateScenarioModal } from "./DuplicateScenarioModal";
import { MarkerEditForm } from "./MarkerEditForm";

type Device = "mobile" | "tablet" | "desktop";

const DEVICES: Array<{ id: Device; label: string; icon: string; frame: string }> = [
  { id: "mobile", label: "모바일 390px", icon: "smartphone", frame: "390px" },
  { id: "tablet", label: "태블릿 834px", icon: "tablet_mac", frame: "834px" },
  { id: "desktop", label: "데스크톱 전체 폭", icon: "desktop_windows", frame: "100%" },
];

/** 빈 문서의 PREVIEW에 보여 주는 작성 문법: [이름, 키워드, 나머지] */
const GRAMMAR: Array<[string, string, string]> = [
  ["제목", "#", " 시나리오: 제목"],
  ["서버", "endpoint:", " <헤더에서 고른 서버 ID>"],
  ["환경", "environment:", " <헤더에서 고른 환경 ID>"],
  ["태그", "tag:", " regression"],
  ["이어서", "start:", " continue (이전 시나리오가 끝난 화면에서 시작)"],
  ["이동", "Given", " `/login` 페이지로 이동한다"],
  ["입력", "And", " `아이디`에 `값` 입력"],
  ["클릭", "When", " `로그인` 클릭 [대기 10초]"],
  ["순번", "And", " `삭제` [2번째] 클릭"],
  ["확인", "Then", " `주문 목록` 텍스트가 보인다"],
  ["수동", "And", " `인증번호` 수동 입력 [안내 문구]"],
  ["조건", "And", " 화면에 `공지`가 있는 경우 `닫기` 클릭"],
];

const SAMPLE_STEPS = [
  "Given `/login` 페이지로 이동한다",
  "And `아이디`에 `user@example.com` 입력",
  "And `비밀번호` 수동 입력 [테스트 계정 비밀번호]",
  "When `로그인` 클릭 [대기 10초]",
  "Then `마이페이지` 텍스트가 보인다",
];

const KEYWORD = /^(Given|When|Then|And|But|If)\b/;
const LINKED = "#3d8ce0";
const UNLINKED = "#c08a15";
const pad2 = (value: number) => String(value).padStart(2, "0");
const hostOf = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};
const pathOf = (url: string) => {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/"; } catch { return "/"; }
};
/** 시나리오가 이동 단계로 시작하면 그 경로, 아니면 기준 주소에서 연다. */
const startUrlOf = (scenario: Scenario, baseUrl: string) => {
  try {
    const first = scenario.steps[0];
    return first?.action === "goto" ? new URL(routePath(first.target), baseUrl).href : resolveScenarioUrl(scenario, baseUrl).url;
  } catch { return ""; }
};

type Props = {
  mode: "text" | "marker";
  scenario: Scenario;
  sourceMarkdown: string;
  sidebar: ReactNode;
  /** 현재 시나리오의 엔드포인트와 선택한 환경으로 해석한 기준 주소. */
  baseUrl: string;
  /** 엔드포인트별 기준 주소 (PREVIEW 행의 주소 표시) */
  resolveBaseUrl: (endpointId?: string) => string;
  webEndpoints: Array<{ id: string; name: string }>;
  defaultEndpointId: string;
  previews: Scenario[];
  markerScenarioId: string;
  selectedId: string;
  isAddingMarker: boolean;
  markersVisible: boolean;
  markerDialog: Step | null;
  pendingMarker: Step | null;
  onSelectMarkerScenario: (id: string) => void;
  onAddNextScenario: (start: { continuePrevious: true } | { continuePrevious: false; path: string }) => void;
  onSelectUploadFile: () => Promise<string | null>;
  onSourceChange: (markdown: string) => void;
  onScenarioChange: (scenario: Scenario) => void;
  onBeginMarkerPlacement: () => void;
  onCancelMarkerPlacement: () => void;
  onToggleMarkersVisible: () => void;
  onPlaceMarker: (position: { x: number; y: number; target: string; action: Action; markerViewport?: Step["markerViewport"]; markerPageUrl?: string }) => void;
  onDeleteLast: () => void;
  onClearSteps: () => void;
  onSelectStep: (id: string) => void;
  onEditStep: (step: Step) => void;
  onDeleteStep: (id: string) => void;
  onReorderSteps: (draggedId: string, targetId: string) => void;
  onUpdateMarkerDialog: (changes: Partial<Step>) => void;
  onCloseMarkerDialog: () => void;
  onCompleteMarkerDialog: () => void;
  onDuplicateScenario: (
    scenarioId: string,
    nameTemplate: string,
    cases: Array<Record<string, string>>,
  ) => void;
};

export const ScenarioEditorPage = ({
  mode,
  scenario,
  sourceMarkdown,
  sidebar,
  baseUrl,
  resolveBaseUrl,
  webEndpoints,
  defaultEndpointId,
  previews,
  markerScenarioId,
  selectedId,
  isAddingMarker,
  markersVisible,
  markerDialog,
  pendingMarker,
  onSelectMarkerScenario,
  onAddNextScenario,
  onSelectUploadFile,
  onSourceChange,
  onScenarioChange,
  onBeginMarkerPlacement,
  onCancelMarkerPlacement,
  onToggleMarkersVisible,
  onPlaceMarker,
  onDeleteLast,
  onClearSteps,
  onSelectStep,
  onEditStep,
  onDeleteStep,
  onReorderSteps,
  onUpdateMarkerDialog,
  onCloseMarkerDialog,
  onCompleteMarkerDialog,
  onDuplicateScenario,
}: Props) => {
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const lineNumbersRef = useRef<HTMLOListElement | null>(null);
  const [openPreviewIds, setOpenPreviewIds] = useState<Set<string>>(
    () => new Set(previews[0] ? [previews[0].id] : []),
  );
  const togglePreview = (id: string) =>
    setOpenPreviewIds((ids) => {
      const next = new Set(ids);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [dupTarget, setDupTarget] = useState<Scenario | null>(null);
  const stepDrag = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const targetFrameRef = useRef<Electron.WebviewTag | null>(null);
  const [nextScenario, setNextScenario] = useState<{ continuePrevious: boolean; path: string } | null>(null);
  const navigateFrame = (url: string) => {
    if (!url) return;
    try { void targetFrameRef.current?.loadURL(url).catch(() => undefined); }
    catch { /* 웹뷰가 아직 붙지 않았으면 src로 처음 연 주소를 유지한다. */ }
  };
  const openedScenarioId = useRef(markerScenarioId);
  const frameSrc = useRef({ key: "", url: "about:blank" });
  // 편집 대상을 바꾸면 새로 시작하는 시나리오는 시작 경로로 열고, 이어서 작성하는 시나리오는 지금 화면을 그대로 둔다.
  useEffect(() => {
    if (mode !== "marker" || openedScenarioId.current === markerScenarioId) return;
    openedScenarioId.current = markerScenarioId;
    setNextScenario(null);
    if (!scenario.continuePrevious) navigateFrame(startUrlOf(scenario, baseUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, markerScenarioId]);

  useEffect(() => {
    if (!isAddingMarker) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelMarkerPlacement();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [isAddingMarker, onCancelMarkerPlacement]);

  const clearStepDrag = () => {
    stepDrag.current = null;
    setDraggedStepId(null);
  };

  const placeMarkerAt = async (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - bounds.left) / bounds.width) * 1000) / 10;
    const y = Math.round(((event.clientY - bounds.top) / bounds.height) * 1000) / 10;
    const relativeX = (event.clientX - bounds.left) / bounds.width;
    const relativeY = (event.clientY - bounds.top) / bounds.height;
    let marker: { target: string; action: Action } = { target: "", action: "click" };
    try {
      marker = await targetFrameRef.current?.executeJavaScript(
        `(() => {
          const element = document.elementFromPoint(
            ${relativeX} * window.innerWidth,
            ${relativeY} * window.innerHeight,
          );
          const target = element?.closest('label, button, [role="button"], a, input, select, textarea, [data-label], [aria-label]') ?? element;
          if (!target) return '';
          const action = target.matches('select') ? 'select' : 'click';
          if (target.matches('select')) {
            const label = target.labels?.[0]?.innerText || target.getAttribute('aria-label');
            if (label) return { target: label.replace(/\\s+/g, ' ').trim(), action };
          }

          const text = (target instanceof HTMLElement ? target.innerText : target.textContent ?? '').replace(/\\s+/g, ' ').trim();
          const choiceInput = target.matches('label') && target.querySelector('input[type="checkbox"], input[type="radio"]');
          if (choiceInput) {
            const attributes = ['data-scope', 'data-part']
              .filter((name) => target.hasAttribute(name))
              .map((name) => '[' + name + '="' + CSS.escape(target.getAttribute(name) ?? '') + '"]')
              .join('');
            if (attributes) return { target: 'css=label' + attributes, action };
          }
          if (text) return { target: text, action };

          const label = target.getAttribute('data-label') || target.getAttribute('aria-label');
          if (label) return { target: label, action };

          const tag = target.tagName.toLowerCase();
          const attributes = ['data-testid', 'data-test', 'data-qa', 'data-scope', 'data-part', 'name', 'type', 'value']
            .filter((name) => target.hasAttribute(name))
            .map((name) => '[' + name + '="' + CSS.escape(target.getAttribute(name) ?? '') + '"]')
            .join('');
          if (attributes) return { target: 'css=' + tag + attributes, action };
          if (target.id) return { target: 'css=#' + CSS.escape(target.id), action };
          const classes = Array.from(target.classList).map((name) => '.' + CSS.escape(name)).join('');
          return { target: 'css=' + tag + classes, action };
        })()`,
      ) ?? marker;
    } catch {
      // 웹뷰가 아직 로드되지 않았거나 접근할 수 없는 경우 직접 입력으로 이어집니다.
    }
    onPlaceMarker({ x, y, ...marker, markerViewport: device, markerPageUrl: targetFrameRef.current?.getURL?.() || baseUrl });
  };

  const lines = sourceMarkdown.split("\n");
  const stepTotal = previews.reduce((total, item) => total + item.steps.length, 0);
  const editorEmpty = stepTotal === 0;
  const fillSample = () => {
    const sample = SAMPLE_STEPS.join("\n");
    onSourceChange(
      previews.length
        ? `${sourceMarkdown.trimEnd()}\n\n${sample}\n`
        : `# 시나리오: 로그인 확인${defaultEndpointId ? `\nendpoint: ${defaultEndpointId}` : ""}\ntag: smoke\n\n${sample}\n`,
    );
  };
  const endpointName = (id?: string) =>
    webEndpoints.find((item) => item.id === (id ?? defaultEndpointId))?.name ?? "웹 엔드포인트 없음";
  const previewAddress = (item: Scenario) => {
    if (item.continuePrevious) return [endpointName(item.endpointId), "이전 시나리오에 이어서"].join(" · ");
    const base = resolveBaseUrl(item.endpointId);
    const path = item.steps.find((step) => step.action === "goto")?.target ?? "";
    return [endpointName(item.endpointId), base ? `${hostOf(base)}${path.startsWith("/") ? path : ""}` : ""].filter(Boolean).join(" · ");
  };

  const editingId = markerDialog && !pendingMarker ? markerDialog.id : null;
  const deviceFrame = DEVICES.find((d) => d.id === device) ?? DEVICES[2];
  const unlinkedCount = scenario.steps.filter((step) => !step.connected).length;
  const pinColor = (step: Step) => (step.connected ? LINKED : UNLINKED);
  const markerTargetUrl = baseUrl ? startUrlOf(scenario, baseUrl) : "";
  // 화면 추출에 들어오거나 기준 주소가 바뀔 때 연 주소만 src로 넘긴다.
  // 이후 이동은 loadURL로 하므로 이동 단계를 고쳐도 웹뷰가 다시 열리지 않는다.
  const frameKey = `${mode}|${baseUrl}`;
  if (frameSrc.current.key !== frameKey) {
    frameSrc.current = { key: frameKey, url: markerTargetUrl || "about:blank" };
    openedScenarioId.current = markerScenarioId;
  }
  const toggleMarker = (step: Step) => {
    onSelectStep(step.id);
    if (editingId === step.id) onCloseMarkerDialog();
    else onEditStep(step);
  };
  const markerForm = (marker: Step, isNew: boolean) => (
    <MarkerEditForm
      marker={marker}
      isNew={isNew}
      onChange={onUpdateMarkerDialog}
      onSelectUploadFile={onSelectUploadFile}
      onCancel={onCloseMarkerDialog}
      onComplete={() => {
        onCompleteMarkerDialog();
        // 페이지 이동 단계는 화면도 그 경로로 새로 연다.
        if (marker.action === "goto" && marker.target.trim() && baseUrl) {
          try { navigateFrame(new URL(routePath(marker.target), baseUrl).href); }
          catch { /* 잘못된 경로는 실행 때 오류로 안내한다. */ }
        }
      }}
    />
  );
  const visiblePins = [...scenario.steps, ...(pendingMarker ? [pendingMarker] : [])];

  return (
    <>
    {mode === "text" ? (
      <div className="ws-editor">
        {sidebar}
        <section className="ws-editor-source">
          <div className="ws-col-label">
            <span>MARKDOWN</span>
            <span>
              {lines.length} lines · {previews.length} scenarios
            </span>
          </div>
          <div className="markdown-editor-body">
            <ol className="markdown-line-numbers" aria-hidden="true" ref={lineNumbersRef}>
              {lines.map((_, index) => <li key={index}>{index + 1}</li>)}
            </ol>
            <textarea
              className="scenario-source"
              data-ck-scroll="light"
              value={sourceMarkdown}
              spellCheck={false}
              placeholder={"# 시나리오: 제목\nendpoint: <엔드포인트 ID>\n\nGiven `/login` 페이지로 이동한다"}
              onChange={(event) => onSourceChange(event.target.value)}
              onScroll={(event) => {
                if (lineNumbersRef.current)
                  lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
              }}
              aria-label="시나리오 Markdown 원본"
            />
          </div>
        </section>
        <aside className="ws-editor-preview">
          <div className="ws-col-label">
            <span>PREVIEW</span>
            <span>{previews.length ? `${previews.length} scenarios · ${stepTotal} steps` : "시나리오 없음"}</span>
          </div>
          <div className="ws-preview-body" data-ck-scroll="light">
            {editorEmpty && (
              <div className="ws-grammar">
                <div className="ws-grammar-head">
                  <strong>
                    {previews.length === 0
                      ? "시나리오 형식을 인식하지 못했습니다."
                      : "작성 문법"}
                  </strong>
                  <Button variant="secondary" onClick={fillSample}>
                    <span className="msi" aria-hidden="true">note_add</span>
                    예시 넣기
                  </Button>
                </div>
                <dl className="ws-grammar-table">
                  {GRAMMAR.map(([label, keyword, rest]) => (
                    <Fragment key={label}>
                      <dt>{label}</dt>
                      <dd title={`${keyword}${rest}`}><b>{keyword}</b>{rest}</dd>
                    </Fragment>
                  ))}
                </dl>
                <p className="ws-grammar-note">
                  Given · When · Then · And 로 시작하는 줄이 단계가 되며, 작성 순서대로 실행됩니다.
                </p>
              </div>
            )}
            {(editorEmpty ? [] : previews).map((preview) => {
              const isOpen = openPreviewIds.has(preview.id);
              const unlinked = preview.steps.filter((step) => !step.connected).length;
              const address = previewAddress(preview);
              return (
                <div className="ws-preview-item" key={preview.id}>
                  <div
                    className="ws-preview-row"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => togglePreview(preview.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        togglePreview(preview.id);
                      }
                    }}
                  >
                    <span className="msi ws-preview-caret" aria-hidden="true">
                      {isOpen ? "expand_more" : "chevron_right"}
                    </span>
                    <div>
                      <div className="ws-preview-title">
                        <h2 title={preview.title}>{preview.title}</h2>
                        {preview.tag && <em className="ws-tag">{preview.tag}</em>}
                      </div>
                      <p title={address}>{address}</p>
                    </div>
                    <span className="ws-preview-count">{preview.steps.length}단계</span>
                    {unlinked > 0 && <span className="ws-preview-unlinked" title="선택자 미연결 단계">미연결 {unlinked}</span>}
                    <Button variant="secondary"
                      className="ws-preview-dup"
                      title="입력값만 바꿔 케이스 복제"
                      aria-label="템플릿 복제"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDupTarget(preview);
                      }}
                    >
                      <span className="msi" aria-hidden="true">content_copy</span>
                      복제
                    </Button>
                  </div>
                  {isOpen && (
                    <ol className="ws-steps">
                      {preview.steps.map((step, stepIndex) => (
                        <li key={step.id}>
                          <b>{stepIndex + 1}</b>
                          <ActionTag action={step.action} />
                          <span className="ws-step-target" title={actionText(step)}>
                            {actionText(step)}
                          </span>
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
          </div>
        </aside>
      </div>
    ) : (
      <div className="extract-shell">
        <div className="extract-topbar">
          <div className="extract-navbtns">
            <Button variant="ghost" iconOnly
              className="extract-navbtn"
              title="뒤로"
              aria-label="뒤로"
              onClick={() => targetFrameRef.current?.goBack()}
            >
              <span className="msi" aria-hidden="true">arrow_back</span>
            </Button>
            <Button variant="ghost" iconOnly
              className="extract-navbtn"
              title="앞으로"
              aria-label="앞으로"
              onClick={() => targetFrameRef.current?.goForward()}
            >
              <span className="msi" aria-hidden="true">arrow_forward</span>
            </Button>
            <Button variant="ghost" iconOnly
              className="extract-navbtn"
              title="새로고침"
              aria-label="대상 페이지 새로고침"
              onClick={() => targetFrameRef.current?.reload()}
            >
              <span className="msi" aria-hidden="true">refresh</span>
            </Button>
          </div>
          <div className="extract-url" title={markerTargetUrl || undefined}>
            <span className="msi extract-url-lock" aria-hidden="true">lock</span>
            <span className="extract-url-base" title={baseUrl || undefined}>
              {baseUrl || "설정에서 이 엔드포인트의 환경별 주소를 넣어 주세요."}
            </span>
          </div>
          <div className="extract-devices" role="group" aria-label="화면 폭">
            {DEVICES.map((d) => (
              <Button
                key={d.id}
                className={device === d.id ? "active" : ""}
                aria-pressed={device === d.id}
                title={d.label}
                aria-label={d.label}
                onClick={() => setDevice(d.id)}
              >
                <span className="msi" aria-hidden="true">{d.icon}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="extract-body">
          <aside className="extract-markers">
            <div className="extract-target-picker">
              <div className="extract-target-head">
                <span id="extract-target-label">편집 대상</span>
                <Button
                  variant="ghost"
                  className="extract-next-scenario"
                  aria-expanded={Boolean(nextScenario)}
                  disabled={!previews.length}
                  title="이 문서에 다음 시나리오 추가"
                  onClick={() => setNextScenario((current) => current ? null : {
                    continuePrevious: true,
                    path: pathOf(targetFrameRef.current?.getURL?.() ?? ""),
                  })}
                >
                  <span className="msi" aria-hidden="true">playlist_add</span>
                  다음 시나리오
                </Button>
              </div>
              <span className="extract-target-select">
                <select
                  aria-labelledby="extract-target-label"
                  value={markerScenarioId}
                  disabled={previews.length < 2}
                  onChange={(event) => onSelectMarkerScenario(event.target.value)}
                >
                  {previews.map((item, index) => (
                    <option key={item.id} value={item.id}>
                      {pad2(index + 1)}  {item.continuePrevious ? "↳ " : ""}{item.title}
                    </option>
                  ))}
                  {!previews.length && <option value="">시나리오 없음</option>}
                </select>
                <span className="msi" aria-hidden="true">unfold_more</span>
              </span>
              {scenario.continuePrevious && (
                <p className="extract-target-note">이전 시나리오의 마지막 화면에서 이어서 실행합니다.</p>
              )}
              {nextScenario && (
                <div className="marker-form extract-next-form">
                  <div className="marker-form-field">
                    <span id="extract-next-start">시작 위치</span>
                    <div className="marker-form-yn extract-next-start" role="radiogroup" aria-labelledby="extract-next-start">
                      <Button role="radio" aria-checked={nextScenario.continuePrevious} className={nextScenario.continuePrevious ? "on" : ""} onClick={() => setNextScenario({ ...nextScenario, continuePrevious: true })}>이전 단계에 이어서</Button>
                      <Button role="radio" aria-checked={!nextScenario.continuePrevious} className={nextScenario.continuePrevious ? "" : "on"} onClick={() => setNextScenario({ ...nextScenario, continuePrevious: false })}>새 URL 경로로 시작</Button>
                    </div>
                  </div>
                  {nextScenario.continuePrevious ? (
                    <div className="marker-form-note">지금 화면에서 이어서 마커를 찍습니다. 실행할 때는 앞 시나리오가 끝난 화면에서 시작합니다.</div>
                  ) : (
                    <label className="marker-form-field">
                      <span>이동 경로</span>
                      <Input
                        mono
                        autoFocus
                        spellCheck={false}
                        value={nextScenario.path}
                        onChange={(event) => setNextScenario({ ...nextScenario, path: event.target.value })}
                        placeholder="이동 경로 (예: /login)"
                      />
                    </label>
                  )}
                  <div className="marker-form-actions">
                    <Button variant="secondary" onClick={() => setNextScenario(null)}>취소</Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (nextScenario.continuePrevious) {
                          onAddNextScenario({ continuePrevious: true });
                        } else {
                          onAddNextScenario({ continuePrevious: false, path: nextScenario.path });
                        }
                        setNextScenario(null);
                      }}
                    >
                      추가
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="extract-col-label">
              <span>MARKERS</span>
              <span className="extract-col-meta">{scenario.steps.length}개</span>
            </div>
            <div className="extract-markers-list" data-ck-scroll="light">
              {!scenario.steps.length && !pendingMarker && (
                <div className="extract-markers-empty">
                  <span className="msi" aria-hidden="true">ads_click</span>
                  <p>마커 추가를 누르고 화면에서 요소를 선택하세요.</p>
                </div>
              )}
              {scenario.steps.map((step) => {
                const editing = editingId === step.id;
                return (
                  <div
                    key={step.id}
                    className={`extract-marker-item${selectedId === step.id || editing ? " selected" : ""}${draggedStepId === step.id ? " dragging" : ""}`}
                    data-step-id={step.id}
                  >
                    <div className="extract-marker-row">
                      <Button
                        className="extract-marker-drag"
                        aria-label={`${step.id}번 단계 순서 변경`}
                        title="드래그해 순서 변경"
                        onPointerDown={(event) => {
                          stepDrag.current = {
                            id: step.id,
                            pointerId: event.pointerId,
                            startX: event.clientX,
                            startY: event.clientY,
                            moved: false,
                          };
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={(event) => {
                          const drag = stepDrag.current;
                          if (!drag || drag.pointerId !== event.pointerId) return;
                          if (
                            !drag.moved &&
                            Math.hypot(
                              event.clientX - drag.startX,
                              event.clientY - drag.startY,
                            ) > 5
                          ) {
                            drag.moved = true;
                            setDraggedStepId(drag.id);
                          }
                        }}
                        onPointerUp={(event) => {
                          const drag = stepDrag.current;
                          if (!drag || drag.pointerId !== event.pointerId) return;
                          event.currentTarget.releasePointerCapture(event.pointerId);
                          if (drag.moved) {
                            const target = document
                              .elementFromPoint(event.clientX, event.clientY)
                              ?.closest<HTMLDivElement>("[data-step-id]");
                            const targetId = target?.dataset.stepId;
                            if (targetId) onReorderSteps(drag.id, targetId);
                            event.preventDefault();
                          }
                          clearStepDrag();
                        }}
                        onPointerCancel={clearStepDrag}
                      >
                        <span className="msi" aria-hidden="true">drag_indicator</span>
                      </Button>
                      <Button
                        className="extract-marker-main"
                        aria-expanded={editing}
                        title={`${step.target} · 눌러서 편집`}
                        onClick={() => toggleMarker(step)}
                      >
                        <b style={{ background: pinColor(step) }}>{step.id}</b>
                        <ActionTag action={step.action} className="extract-marker-op" />
                        <span className="extract-marker-target">{step.target}</span>
                      </Button>
                      <span className={`extract-marker-link${step.connected ? "" : " unlinked"}`}>
                        {step.connected ? "linked" : "unlinked"}
                      </span>
                      <Button
                        className="extract-marker-delete"
                        onClick={() => onDeleteStep(step.id)}
                        aria-label="단계 삭제"
                        title="삭제"
                      >
                        <span className="msi" aria-hidden="true">close</span>
                      </Button>
                    </div>
                    {editing && markerDialog && markerForm(markerDialog, false)}
                  </div>
                );
              })}
              {pendingMarker && (
                <div className="extract-marker-item selected pending">
                  <div className="extract-marker-row">
                    <span className="extract-marker-drag" aria-hidden="true">
                      <span className="msi">drag_indicator</span>
                    </span>
                    <span className="extract-marker-main">
                      <b style={{ background: LINKED }}>{pendingMarker.id}</b>
                      <ActionTag action={pendingMarker.action} className="extract-marker-op" />
                      <span className="extract-marker-target">{pendingMarker.target || "새 마커"}</span>
                    </span>
                  </div>
                  {markerForm(pendingMarker, true)}
                </div>
              )}
            </div>
            <div className="extract-marker-tools">
              <Button
                variant={isAddingMarker ? "secondary" : "primary"}
                className="extract-add-marker"
                aria-pressed={isAddingMarker}
                onClick={isAddingMarker ? onCancelMarkerPlacement : onBeginMarkerPlacement}
              >
                <span className="msi" aria-hidden="true">{isAddingMarker ? "close" : "add"}</span>
                {isAddingMarker ? "선택 중 · Esc" : "마커 추가"}
              </Button>
              <Button variant="secondary" iconOnly
                aria-pressed={!markersVisible}
                aria-label={markersVisible ? "마커 숨기기" : "마커 보이기"}
                title={markersVisible ? "마커 숨기기" : "마커 보이기"}
                onClick={onToggleMarkersVisible}
              >
                <span className="msi" aria-hidden="true">{markersVisible ? "visibility_off" : "visibility"}</span>
              </Button>
              <Button variant="secondary" iconOnly aria-label="마지막 마커 삭제" title="마지막 마커 삭제" disabled={!scenario.steps.length} onClick={onDeleteLast}>
                <span className="msi" aria-hidden="true">backspace</span>
              </Button>
              <Button variant="secondary" iconOnly className="extract-clear" aria-label="전체 초기화" title="전체 초기화" disabled={!scenario.steps.length} onClick={onClearSteps}>
                <span className="msi" aria-hidden="true">delete_sweep</span>
              </Button>
            </div>
          </aside>

          <div className="extract-canvas">
            <div className="extract-stage">
              <div
                className={`extract-frame${isAddingMarker ? " picking" : ""}`}
                style={{ width: deviceFrame.frame }}
              >
                <webview
                  ref={targetFrameRef}
                  className="extract-target"
                  src={frameSrc.current.url}
                  aria-label="시나리오 대상 페이지"
                />
                {!baseUrl && (
                  <div className="extract-fallback">
                    <div className="extract-fallback-title">대상 페이지 주소가 없습니다</div>
                    <p>설정 &gt; 엔드포인트 × 환경에서 이 엔드포인트의 주소를 넣으면 여기에서 페이지를 열어 마커를 찍을 수 있습니다.</p>
                  </div>
                )}
                {isAddingMarker && (
                  <>
                    <div
                      className="extract-placement-layer"
                      onClick={(event) => void placeMarkerAt(event)}
                      aria-label="마커를 추가할 위치"
                    />
                    <div className="extract-picking-hint" role="status">
                      <i aria-hidden="true" />요소를 클릭해 마커 추가<span>Esc 취소</span>
                    </div>
                  </>
                )}
                {markersVisible && visiblePins.map((step) => {
                  if (step.x === undefined || step.y === undefined || (step.markerViewport && step.markerViewport !== device)) return null;
                  const selected = selectedId === step.id || editingId === step.id || step === pendingMarker;
                  return (
                    <Button
                      key={step === pendingMarker ? "pending" : step.id}
                      className={"extract-pin" + (step.connected ? "" : " unlinked") + (selected ? " selected" : "")}
                      style={{
                        left: `${step.x}%`,
                        top: `${step.y}%`,
                      }}
                      onClick={() => { if (step !== pendingMarker) toggleMarker(step); }}
                      aria-label={`${step.id}번 ${step.target} 마커`}
                      title={step.target}
                    >
                      {step.id}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="extract-status">
              <span className={`extract-status-dot${baseUrl ? "" : " off"}`}>{baseUrl ? "대상 연결됨" : "대상 주소 없음"}</span>
              <span className="mono">{deviceFrame.label}</span>
              <span className={`mono extract-status-unlinked${unlinkedCount ? " warn" : ""}`}>
                {unlinkedCount ? `선택자 미연결 ${unlinkedCount}` : "모든 마커 연결됨"}
              </span>
            </div>
          </div>
        </div>
      </div>
    )}
    {dupTarget && (
      <DuplicateScenarioModal
        scenario={dupTarget}
        onDuplicate={onDuplicateScenario}
        onClose={() => setDupTarget(null)}
      />
    )}
    </>
  );
};
