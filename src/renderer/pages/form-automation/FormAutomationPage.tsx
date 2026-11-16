import { SessionRecordingsDialog } from "./SessionRecordingsDialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  clearFieldsScript,
  readCurrentFieldsScript,
  highlightFieldsScript,
  discoverFieldsScript,
  passiveDiscoverFieldsScript,
  fillFieldsScript,
  focusRichTextScript,
  selectDateRangeScript,
} from "./browserScripts";
import {
  BROWSER_IDENTITY_LABELS,
  MAX_FORM_SESSIONS,
  browserSessionPartition,
  browserUserAgent,
  cloneFields,
  defaultBrowserSession,
  detectedCases,
  includedCaseFields,
  normalizeBrowserSessions,
  pageScopeFromUrl,
  pageScopeLabel,
  reorderBrowserSessions,
  type AutofillCase,
  type BrowserSession,
  type BrowserIdentity,
  type DateRangeValue,
  type DetectedField,
  type FieldValue,
  type FileValue,
} from "./model";
import { ScreenTestHeader } from "./ScreenTestHeader";
import { Popover } from "../../shared/ui/Popover";
import { NetworkPanel, OverridePanel } from "./InspectorPanels";
import { useSharedOpenApi } from "./useSharedOpenApi";
import { useSplitPaneResize } from "./useSplitPaneResize";
import { contractForSharedEvent, matchSharedOpenApi } from "./sharedOpenApi";
import { specForNetworkEvent } from "./networkSpec";
import { ScreenshotEditor, type ScreenshotCapture } from "./ScreenshotEditor";
import { FormAutomationStorageProvider, useStoredState } from "./StoredState";
import { NativeInspectorPage } from "./NativeInspectorPage";
import {
  apiEventClipboardText,
  isSessionError,
  isNetworkFailure,
  isNextInternalNetworkEvent,
  mergeNetworkEvents,
  normalizedEndpointPath,
  overrideResponseSchema,
  safeJson,
  stringify,
  type NetworkEvent,
  type OverrideRule,
} from "./liveQa";

import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
type WebviewElement = HTMLElement & {
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  executeJavaScript: (script: string) => Promise<unknown>;
  getURL: () => string;
  getWebContentsId: () => number;
  goBack: () => void;
  goForward: () => void;
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
  setZoomFactor: (factor: number) => void;
  setUserAgent: (userAgent: string) => void;
};

type FillResult = {
  filled: string[];
  missing: string[];
  richText: Array<{ key: string; value: string }>;
  fileInputs: Array<{
    key: string;
    token: string;
    valid: boolean;
    accept: string;
    multiple: boolean;
  }>;
  dateTriggers: Array<{ key: string; value: FieldValue }>;
};

const DEFAULT_URL = "https://example.com";
const VIEWPORT_PRESETS = [
  { id: "desktop", label: "데스크톱 · 화면에 맞춤", width: 0, height: 0 },
  { id: "mobile-small", label: "모바일 · 375 × 667", width: 375, height: 667 },
  { id: "mobile", label: "모바일 · 390 × 844", width: 390, height: 844 },
  { id: "mobile-large", label: "모바일 · 412 × 915", width: 412, height: 915 },
  { id: "tablet", label: "태블릿 · 768 × 1024", width: 768, height: 1024 },
];

const MaterialIcon = ({ name }: { name: string }): ReactElement => (
  <span className="msi" aria-hidden="true">{name}</span>
);

const currentWebviewUrl = (webview: WebviewElement | null, fallback: string) => {
  try {
    return webview?.getURL() || fallback;
  } catch {
    return fallback;
  }
};

const urlHost = (value: string): string => {
  try {
    return new URL(value).host;
  } catch {
    return "주소 미설정";
  }
};

const isDateRange = (value: FieldValue): value is DateRangeValue =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) && "__qaDateRange" in value);

const isFileValue = (value: FieldValue): value is FileValue =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) && "__qaFile" in value);

const CaseValueInput = ({
  field,
  value,
  disabled = false,
  onChange,
}: {
  field: DetectedField;
  value: FieldValue;
  disabled?: boolean;
  onChange: (value: FieldValue) => void;
}) => {
  if (field.type === "date-trigger" && isDateRange(value)) {
    return (
      <div className="fa-date-range">
        <Input
          aria-label={`${field.label || field.name} 시작일`}
          type="date"
          disabled={disabled}
          value={value.start}
          onChange={(event) => onChange({ ...value, start: event.target.value })}
        />
        <span>~</span>
        <Input
          aria-label={`${field.label || field.name} 종료일`}
          type="date"
          disabled={disabled}
          value={value.end}
          onChange={(event) => onChange({ ...value, end: event.target.value })}
        />
      </div>
    );
  }
  if (field.type === "date-trigger") {
    return (
      <Input
        aria-label={`${field.label || field.name} 값`}
        type="date"
        disabled={disabled}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === "file" && isFileValue(value)) {
    return (
      <select
        aria-label={`${field.label || field.name} 파일 케이스`}
        disabled={disabled}
        value={value.valid ? "valid" : "invalid"}
        onChange={(event) => onChange({ ...value, valid: event.target.value === "valid" })}
      >
        <option value="valid">허용 형식 파일</option>
        <option value="invalid">비허용 형식 파일</option>
      </select>
    );
  }
  if (field.type === "checkbox") {
    return (
      <label className="fa-checkbox">
        <input
          type="checkbox"
          disabled={disabled}
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{value ? "선택" : "해제"}</span>
      </label>
    );
  }
  if ((field.type === "radio" || field.type === "select-one") && field.options.length) {
    return (
      <select
        aria-label={`${field.label || field.name} 값`}
        disabled={disabled}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">(빈 값)</option>
        {field.options.filter((option) => !option.disabled).map((option) => (
          <option key={`${option.value}-${option.label}`} value={option.value}>
            {option.label || option.value}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "select-multiple" || field.type === "checkbox-group" || Array.isArray(value)) {
    return (
      <Input
        aria-label={`${field.label || field.name} 값`}
        disabled={disabled}
        value={(Array.isArray(value) ? value : []).join(", ")}
        onChange={(event) =>
          onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))
        }
      />
    );
  }
  if (field.type === "textarea" || field.type === "contenteditable" || String(value ?? "").length > 80) {
    return (
      <textarea
        aria-label={`${field.label || field.name} 값`}
        disabled={disabled}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const inputType = (["date", "datetime-local", "email", "month", "number", "password", "tel", "time", "url"] as const).find((type) => type === field.type) ?? "text";
  return (
    <Input
      aria-label={`${field.label || field.name} 값`}
      type={inputType}
      disabled={disabled}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};

export const FormAutomationPage = (): ReactElement => {
  const [native, setNative] = useState(false);
  return <FormAutomationStorageProvider>{native
    ? <NativeInspectorPage onBack={() => setNative(false)} />
    : <FormAutomationContent onNative={() => setNative(true)} />}</FormAutomationStorageProvider>;
};

const FormAutomationContent = ({ onNative }: { onNative: () => void }): ReactElement => {
  const [targetUrl, setTargetUrl] = useStoredState("checkly-form-target-url", DEFAULT_URL);
  const [browserTabs, setBrowserTabs] = useStoredState<BrowserSession[]>(
    "checkly-form-browser-sessions",
    [defaultBrowserSession(targetUrl)],
  );
  const [activeTabId, setActiveTabId] = useStoredState("checkly-form-active-session", "default");
  const activeTab = browserTabs.find((item) => item.id === activeTabId) ?? browserTabs[0];
  const [draftUrl, setDraftUrl] = useState(activeTab?.currentPageUrl || targetUrl);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState("");
  const [newSessionIdentity, setNewSessionIdentity] = useState<BrowserIdentity>("chrome");
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<{ id: string; placeAfter: boolean } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [splitTabIds, setSplitTabIds] = useState<[string, string] | null>(null);
  const splitResize = useSplitPaneResize(Boolean(splitTabIds));
  const [inspectorWidth, setInspectorWidth] = useStoredState("checkly-form-inspector-width", 440);
  const [caseListHeight, setCaseListHeight] = useStoredState<number | null>("checkly-form-case-list-height", null);
  const [caseListHeightPreview, setCaseListHeightPreview] = useState<number | null>(null);
  const [discoveredFields, setDiscoveredFields] = useState<DetectedField[]>([]);
  const [savedCases, setSavedCases] = useStoredState<AutofillCase[]>("checkly-form-saved-cases", []);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [caseFilter, setCaseFilter] = useState<"all" | "success" | "failure">("all");
  const [caseDraftName, setCaseDraftName] = useState("");
  const [caseDraftKind, setCaseDraftKind] = useState<"success" | "failure">("success");
  const [caseDraftFields, setCaseDraftFields] = useState<Record<string, FieldValue>>({});
  const [caseDraftExcludedFields, setCaseDraftExcludedFields] = useState<string[]>([]);
  const [drawerTab, setDrawerTab] = useState<"network" | "cases" | "override">("cases");
  const [networkEvents, setNetworkEvents] = useState<NetworkEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<NetworkEvent | null>(null);
  const [networkFilter, setNetworkFilter] = useState<"all" | "errors" | "warnings">("all");
  const [overrides, setOverrides] = useStoredState<OverrideRule[]>("checkly-form-overrides", []);
  const [selectedOverrideId, setSelectedOverrideId] = useState("");
  const [overrideEditing, setOverrideEditing] = useState(false);
  const [overrideBodyText, setOverrideBodyText] = useState("{}");
  const [overrideEditorMode, setOverrideEditorMode] = useState<"fields" | "json">("fields");
  const sharedOpenApi = useSharedOpenApi();
  const [eventSpecSources, setEventSpecSources] = useState<Record<string, string>>({});
  const [capture, setCapture] = useState<ScreenshotCapture | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const closeRecordings = useCallback(() => setRecordingsOpen(false), []);
  const [zoomPercent, setZoomPercent] = useStoredState("checkly-form-browser-zoom", 100);
  const [viewportId, setViewportId] = useStoredState("checkly-form-browser-viewport", "desktop");
  const [landscape, setLandscape] = useStoredState("checkly-form-browser-landscape", false);
  const viewport = VIEWPORT_PRESETS.find((item) => item.id === viewportId) ?? VIEWPORT_PRESETS[0];
  const viewportWidth = landscape ? viewport.height : viewport.width;
  const viewportHeight = landscape ? viewport.width : viewport.height;
  const zoomFactor = Math.min(1.25, Math.max(0.5, Number(zoomPercent) / 100));
  const [toast, setToast] = useState("");
  const [showGuide, setShowGuide] = useStoredState("checkly-form-show-guide", true);
  const webviewRefs = useRef(new Map<string, WebviewElement>());
  const refCallbacks = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const activeTabIdRef = useRef(activeTab?.id || "default");
  const browserTabsRef = useRef(browserTabs);
  const loadStartedAtRef = useRef(new Map<string, number>());
  const overridesRef = useRef(overrides);
  activeTabIdRef.current = activeTab?.id || "default";
  browserTabsRef.current = browserTabs;
  overridesRef.current = overrides;

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }, []);

  const updateBrowserTab = useCallback(
    (tabId: string, patch: Partial<BrowserSession>) => {
      setBrowserTabs((items) =>
        items.map((item) => item.id === tabId ? { ...item, ...patch } : item),
      );
    },
    [setBrowserTabs],
  );

  const activeWebview = () => webviewRefs.current.get(activeTabIdRef.current) ?? null;

  const openBrowserDevTools = async () => {
    const webview = activeWebview();
    if (!webview?.getWebContentsId || !window.electronAPI?.openFormAutomationDevTools) {
      showToast("개발자 도구는 Electron 앱에서 사용할 수 있습니다.");
      return;
    }
    try {
      await window.electronAPI.openFormAutomationDevTools(webview.getWebContentsId());
    } catch (error) {
      showToast(`개발자 도구 열기 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendGuestConfig = useCallback(() => {
    const detail = { overrides };
    for (const webview of webviewRefs.current.values()) {
      try {
        void webview.executeJavaScript(
          `window.dispatchEvent(new CustomEvent('__checkly_form_config__', { detail: ${JSON.stringify(detail)} }))`,
        ).catch(() => undefined);
      } catch {
        /* dom-ready 이전에는 다음 ready 이벤트에서 다시 보낸다. */
      }
    }
  }, [overrides]);

  const recordGuestNetworkEvent = useCallback((
    eventPayload: Omit<NetworkEvent, "id">,
    browserSession: BrowserSession,
  ) => {
    if (isNextInternalNetworkEvent(eventPayload)) return;
    const payload: NetworkEvent = {
      ...eventPayload,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      browserSessionId: browserSession.id,
      browserSessionName: browserSession.name,
      contract: ["fetch", "xhr"].includes(eventPayload.type)
        ? contractForSharedEvent(sharedOpenApi.sources, { ...eventPayload, id: "contract-check" } as NetworkEvent)
        : {
          tone: "danger",
          label: "페이지 오류",
          detail: eventPayload.error || "페이지에서 오류가 발생했습니다.",
        },
    };
    setNetworkEvents((items) => [payload, ...items].slice(0, 1000));
    void window.electronAPI?.saveFormAutomationSessionEvent?.(payload).catch(() => undefined);

  }, [sharedOpenApi.sources]);

  useEffect(() => {
    void window.electronAPI?.readFormAutomationSessionEvents?.(1000)
      .then((items) => setNetworkEvents((current) => mergeNetworkEvents(current, items as NetworkEvent[])))
      .catch(() => undefined);
  }, []);

  useEffect(() => { sendGuestConfig(); }, [sendGuestConfig]);

  const webviewRefFor = (tabId: string) => {
    if (!refCallbacks.current.has(tabId)) {
      refCallbacks.current.set(tabId, (node) => {
        if (node) webviewRefs.current.set(tabId, node as WebviewElement);
        else webviewRefs.current.delete(tabId);
      });
    }
    return refCallbacks.current.get(tabId)!;
  };

  const discoverFields = useCallback(async (selectDefault = false, interactive = true) => {
    const webview = activeWebview();
    if (!webview?.executeJavaScript) {
      if (selectDefault) showToast("필드 자동 감지는 Electron 앱에서 사용할 수 있습니다.");
      return [];
    }
    try {
      const fields = await webview.executeJavaScript(interactive ? discoverFieldsScript : passiveDiscoverFieldsScript) as DetectedField[];
      if (webview !== activeWebview()) return fields;
      setDiscoveredFields(fields);
      if (selectDefault && fields.length) {
        // Delayed page discovery must not replace a case the user just selected.
        setSelectedCaseId(current => current || detectedCases(fields)[0]?.id || "");
      }
      return fields;
    } catch (error) {
      if (selectDefault) showToast(`필드 감지 실패: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }, [showToast]);

  const showTabInSplit = useCallback((tabId: string) => {
    const previousId = activeTabIdRef.current;
    setSplitTabIds((current) => {
      if (!current || current.includes(tabId)) return current;
      return current[1] === previousId ? [current[0], tabId] : [tabId, current[1]];
    });
  }, []);

  const switchBrowserTab = useCallback((tabId: string) => {
    const tab = browserTabsRef.current.find((item) => item.id === tabId);
    if (!tab) return;
    showTabInSplit(tabId);
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    setSelectedEvent(null);
    const url = currentWebviewUrl(webviewRefs.current.get(tabId) ?? null, tab.currentPageUrl || tab.url);
    setDraftUrl(url);
    setTargetUrl(url);
    setDiscoveredFields([]);
  }, [setActiveTabId, setTargetUrl, showTabInSplit]);

  const toggleBrowserSplit = () => {
    if (splitTabIds) {
      setSplitTabIds(null);
      return;
    }
    const otherTab = browserTabs.find((tab) => tab.id !== activeTab.id);
    if (otherTab) setSplitTabIds([activeTab.id, otherTab.id]);
  };

  const selectSplitSession = (paneIndex: number, tabId: string) => {
    setSplitTabIds((current) => {
      if (!current) return current;
      // Choosing the other visible session swaps sides without recreating either guest.
      if (current[1 - paneIndex] === tabId) return [current[1], current[0]];
      return paneIndex === 0 ? [tabId, current[1]] : [current[0], tabId];
    });
    switchBrowserTab(tabId);
  };

  const addBrowserTab = useCallback((browserIdentity: BrowserIdentity = "chrome") => {
    const items = browserTabsRef.current;
    if (items.length >= MAX_FORM_SESSIONS) {
      showToast(`로그인 세션은 최대 ${MAX_FORM_SESSIONS}개까지 열 수 있습니다.`);
      return;
    }
    const id = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const url = currentWebviewUrl(activeWebview(), activeTab?.url || targetUrl);
    const next: BrowserSession = {
      id,
      name: `회원 세션 ${items.length + 1}`,
      browserIdentity,
      url,
      currentPageUrl: url,
      state: "loading",
      history: { back: false, forward: false },
    };
    setBrowserTabs((current) => [...current, next]);
    showTabInSplit(id);
    activeTabIdRef.current = id;
    setActiveTabId(id);
    setDraftUrl(url);
    setTargetUrl(url);
    setEditingTabId(id);
    setEditingTabName(next.name);
    setDiscoveredFields([]);
  }, [activeTab?.url, setActiveTabId, setBrowserTabs, setTargetUrl, showTabInSplit, showToast, targetUrl]);

  const changeBrowserIdentity = (browserIdentity: BrowserIdentity) => {
    updateBrowserTab(activeTab.id, { browserIdentity });
    const webview = activeWebview();
    if (!webview?.setUserAgent) return;
    try {
      webview.setUserAgent(browserUserAgent(browserIdentity, navigator.userAgent, viewport.id.startsWith("mobile")));
      webview.reload();
    } catch (error) {
      showToast(`브라우저 식별 변경 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const changeViewport = (nextId: string) => {
    const mobile = nextId.startsWith("mobile");
    if (mobile !== viewport.id.startsWith("mobile")) {
      for (const tab of browserTabsRef.current) {
        if (tab.browserIdentity !== "safari") continue;
        const webview = webviewRefs.current.get(tab.id);
        if (!webview?.setUserAgent) continue;
        try {
          webview.setUserAgent(browserUserAgent("safari", navigator.userAgent, mobile));
          webview.reload();
        } catch (error) {
          showToast(`브라우저 식별 변경 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    setViewportId(nextId);
  };

  const closeBrowserTab = (tabId: string) => {
    const items = browserTabsRef.current;
    if (items.length <= 1) return;
    const index = items.findIndex((item) => item.id === tabId);
    const next = items.filter((item) => item.id !== tabId);
    const remainingPaneId = splitTabIds?.find((id) => id !== tabId);
    if (splitTabIds?.includes(tabId)) setSplitTabIds(null);
    setBrowserTabs(next);
    webviewRefs.current.delete(tabId);
    if (activeTabIdRef.current === tabId)
      switchBrowserTab(remainingPaneId ?? next[Math.min(index, next.length - 1)].id);
  };

  const finishRenameBrowserTab = () => {
    if (!editingTabId) return;
    const name = editingTabName.trim().slice(0, 30);
    if (name) updateBrowserTab(editingTabId, { name });
    setEditingTabId(null);
    setEditingTabName("");
  };

  useEffect(() => {
    setBrowserTabs((items) => normalizeBrowserSessions(items, targetUrl));
    // 저장된 이전 세션을 앱 시작 시 한 번만 정규화한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!browserTabs.some((item) => item.id === activeTabId) && browserTabs[0])
      switchBrowserTab(browserTabs[0].id);
  }, [activeTabId, browserTabs, switchBrowserTab]);

  const startCapture = useCallback(async () => {
    if (!window.electronAPI?.captureFormAutomationPage) {
      showToast("화면 캡처는 Electron 앱에서 사용할 수 있습니다.");
      return;
    }
    if (capture || captureBusy) return;
    setCaptureBusy(true);
    try { setCapture(await window.electronAPI.captureFormAutomationPage()); }
    catch (error) { showToast(`화면 캡처 실패: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setCaptureBusy(false); }
  }, [capture, captureBusy, showToast]);

  useEffect(() => window.electronAPI?.onFormAutomationCaptureShortcut?.(() => {
    void startCapture();
  }), [startCapture]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.code === "KeyR") {
        event.preventDefault();
        if (!event.repeat) activeWebview()?.reload();
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.shiftKey && event.code === "KeyS") {
        event.preventDefault();
        void startCapture();
        return;
      }
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        addBrowserTab(newSessionIdentity);
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < browserTabsRef.current.length) {
        event.preventDefault();
        switchBrowserTab(browserTabsRef.current[index].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addBrowserTab, newSessionIdentity, startCapture, switchBrowserTab]);

  const tabIds = browserTabs.map((item) => item.id).join("|");
  useEffect(() => {
    const factor = viewport.width ? 1 : zoomFactor;
    for (const webview of webviewRefs.current.values()) {
      try { webview.setZoomFactor(factor); } catch { /* Electron 웹뷰 준비 전 */ }
    }
  }, [tabIds, viewport.width, zoomFactor]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const tabId of tabIds.split("|").filter(Boolean)) {
      const webview = webviewRefs.current.get(tabId);
      if (!webview) continue;
      let discoveryTimer = 0;
      let discoveryScope = "";
      const sessionForTab = () => browserTabsRef.current.find((item) => item.id === tabId)
        ?? defaultBrowserSession(browserTabsRef.current[0]?.url || DEFAULT_URL);
      const isActive = () => activeTabIdRef.current === tabId;
      const focused = () => {
        if (!isActive() && webview.classList.contains("visible")) switchBrowserTab(tabId);
      };
      const updateHistory = () => {
        try {
          updateBrowserTab(tabId, {
            history: { back: webview.canGoBack(), forward: webview.canGoForward() },
          });
        } catch {
          updateBrowserTab(tabId, { history: { back: false, forward: false } });
        }
      };
      const scheduleDiscovery = (url: string) => {
        // Field layout follows the route, not debounced search parameters.
        let scope = url.split("?")[0];
        try {
          const page = new URL(url);
          scope = `${page.origin}${page.pathname}${page.hash}`;
        } catch { /* 주소 파싱 전에는 경로 문자열 사용 */ }
        if (!isActive() || scope === discoveryScope) return;
        discoveryScope = scope;
        window.clearTimeout(discoveryTimer);
        discoveryTimer = window.setTimeout(() => void discoverFields(true, false), 350);
      };
      const ready = () => {
        const url = currentWebviewUrl(webview, sessionForTab().url);
        updateBrowserTab(tabId, { state: "ready", currentPageUrl: url });
        updateHistory();
        if (isActive()) {
          setDraftUrl(url);
          setTargetUrl(url);
          scheduleDiscovery(url);
        }
      };
      const documentReady = () => {
        discoveryScope = "";
        if (isActive()) setDiscoveredFields([]);
        try { webview.setZoomFactor(viewport.width ? 1 : zoomFactor); } catch { /* 웹뷰 준비 전 */ }
        sendGuestConfig();
        ready();
      };
      const loading = () => {
        loadStartedAtRef.current.set(tabId, Date.now());
        updateBrowserTab(tabId, { state: "loading" });
      };
      const failed = (event: Event & { errorCode?: number; isMainFrame?: boolean }) => {
        // 리다이렉트·SPA 이동으로 중단된 로드(ERR_ABORTED)와 하위 프레임 실패는 페이지 실패로 보지 않는다.
        if (event.errorCode === -3 || event.isMainFrame === false) return;
        updateBrowserTab(tabId, { state: "error" });
      };
      const navigated = (event: Event & { url?: string }) => {
        const url = event.url || currentWebviewUrl(webview, sessionForTab().url);
        // The webview owns in-page navigation. Updating its src here reloads SPA routes
        // and discards React Router state passed to screens such as 2FA.
        updateBrowserTab(tabId, { currentPageUrl: url });
        updateHistory();
        if (isActive()) {
          setDraftUrl(url);
          setTargetUrl(url);
          if (event.type === "did-navigate-in-page") scheduleDiscovery(url);
        }
        const owner = sessionForTab();
        const payload: NetworkEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: "navigation",
          category: "activity",
          method: "PAGE",
          url,
          pageUrl: url,
          status: 200,
          at: new Date().toISOString(),
          browserSessionId: owner.id,
          browserSessionName: owner.name,
          contract: { tone: "neutral", label: "페이지 이동", detail: "사용자가 이 페이지로 이동했습니다." },
        };
        setNetworkEvents((items) => items[0]?.type === "navigation"
          && items[0]?.url === url
          && items[0]?.browserSessionId === owner.id
          ? items
          : [payload, ...items].slice(0, 1000));
        void window.electronAPI?.saveFormAutomationSessionEvent?.(payload).catch(() => undefined);
      };
      const message = (event: Event & { channel?: string; args?: unknown[] }) => {
        if (event.channel === "form-automation:focus") {
          focused();
          return;
        }
        if (event.channel === "form-automation:reload-shortcut") {
          if (isActive()) webview.reload();
          return;
        }
        if (event.channel === "form-automation:capture-shortcut") {
          void startCapture();
          return;
        }
        if (event.channel === "form-automation:network-event")
          recordGuestNetworkEvent(event.args?.[0] as Omit<NetworkEvent, "id">, sessionForTab());
      };
      webview.addEventListener("dom-ready", documentReady);
      webview.addEventListener("focus", focused);
      webview.addEventListener("did-stop-loading", ready);
      webview.addEventListener("did-start-loading", loading);
      webview.addEventListener("did-fail-load", failed);
      webview.addEventListener("did-navigate", navigated as EventListener);
      webview.addEventListener("did-navigate-in-page", navigated as EventListener);
      webview.addEventListener("ipc-message", message as EventListener);
      cleanups.push(() => {
        window.clearTimeout(discoveryTimer);
        webview.removeEventListener("dom-ready", documentReady);
        webview.removeEventListener("focus", focused);
        webview.removeEventListener("did-stop-loading", ready);
        webview.removeEventListener("did-start-loading", loading);
        webview.removeEventListener("did-fail-load", failed);
        webview.removeEventListener("did-navigate", navigated as EventListener);
        webview.removeEventListener("did-navigate-in-page", navigated as EventListener);
        webview.removeEventListener("ipc-message", message as EventListener);
      });
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [discoverFields, recordGuestNetworkEvent, sendGuestConfig, setTargetUrl, startCapture, switchBrowserTab, tabIds, updateBrowserTab, viewport.width, zoomFactor]);

  const currentPageUrl = activeTab?.currentPageUrl || activeTab?.url || targetUrl;
  const currentPageScope = pageScopeFromUrl(currentPageUrl);
  const activeNetworkEvents = useMemo(() => networkEvents
    .filter((event) => event.browserSessionId ? event.browserSessionId === activeTab?.id : activeTab?.id === "default")
    .map(event => ["fetch", "xhr"].includes(event.type)
      ? { ...event, contract: contractForSharedEvent(sharedOpenApi.sources, event, eventSpecSources[event.id]) } : event),
  [networkEvents, activeTab?.id, sharedOpenApi.sources, eventSpecSources]);
  const activeSelectedEvent = activeNetworkEvents.find(event => event.id === selectedEvent?.id) ?? null;
  const activeErrorCount = activeNetworkEvents.filter(isNetworkFailure).length;

  const copyText = async (text: string, successMessage: string) => {
    try {
      if (window.electronAPI?.copyFormAutomationText)
        await window.electronAPI.copyFormAutomationText(text);
      else await navigator.clipboard.writeText(text);
      showToast(successMessage);
    } catch (error) {
      showToast(`클립보드 복사 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearSessionLog = async () => {
    setNetworkEvents([]);
    setSelectedEvent(null);
    try { await window.electronAPI?.clearFormAutomationSessionEvents?.(); }
    catch { showToast("화면 기록은 지웠지만 로컬 로그 파일은 지우지 못했습니다."); }
  };

  const downloadSessionLog = async () => {
    try {
      const result = await window.electronAPI?.exportFormAutomationSessionEvents?.();
      if (result) showToast(`네트워크 기록 ${result.count}건을 Excel 파일로 저장했습니다.`);
    } catch (error) {
      showToast(`기록 다운로드 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const copyApiEvent = () => {
    if (!activeSelectedEvent) return;
    void copyText(
      apiEventClipboardText(activeSelectedEvent, targetUrl),
      isSessionError(activeSelectedEvent)
        ? "API 오류 내용을 클립보드에 복사했습니다."
        : "API 요청·응답 스펙을 클립보드에 복사했습니다.",
    );
  };

  const copyCapture = async (dataUrl: string) => {
    try {
      await window.electronAPI.copyFormAutomationImage(dataUrl);
      setCapture(null);
      showToast("주석을 포함한 화면 캡처를 클립보드에 복사했습니다.");
    } catch (error) {
      showToast(`캡처 이미지 복사 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const selectedOverride = overrides.find((item) => item.id === selectedOverrideId) ?? overrides[0];
  let overrideSourceUrl = "";
  if (selectedOverride) {
    try { overrideSourceUrl = new URL(selectedOverride.sourceUrl || selectedOverride.match, currentPageUrl).href; }
    catch { /* A malformed rule or an about:blank guest has no matching document. */ }
  }
  const overrideSpec = matchSharedOpenApi(sharedOpenApi.sources, overrideSourceUrl, selectedOverride?.method);
  const openApi = overrideSpec?.source.document ?? null;
  const selectedOverrideSchema = overrideResponseSchema(openApi,
    selectedOverride && overrideSpec ? { ...selectedOverride, sourceUrl: overrideSpec.url } : selectedOverride);
  const parsedOverrideBody = safeJson(overrideBodyText);
  const latestOverrideEvent = selectedOverride
    ? activeNetworkEvents.find((event) =>
      ["fetch", "xhr"].includes(event.type)
      && String(event.method || "GET").toUpperCase() === selectedOverride.method.toUpperCase()
      && normalizedEndpointPath(event.url) === normalizedEndpointPath(selectedOverride.match)
      && new Date(event.at).getTime() >= (loadStartedAtRef.current.get(activeTab?.id || "") || 0))
    : undefined;
  const selectedOverrideApplied = Boolean(selectedOverride?.enabled && latestOverrideEvent?.overridden);
  const overrideStatus = selectedOverrideApplied
    ? { tone: "success", title: "현재 웹뷰에 적용됨", detail: `${selectedOverride?.method} ${selectedOverride?.match}`, applied: true }
    : selectedOverride?.enabled
      ? { tone: "warning", title: "적용 대기 중", detail: "규칙은 활성 상태지만 덮어쓴 응답이 아직 확인되지 않았습니다.", applied: false }
      : { tone: "neutral", title: "현재 웹뷰에 적용 안 됨", detail: "서버의 원본 응답을 사용합니다.", applied: false };

  useEffect(() => {
    if (!selectedOverrideId && overrides[0]) setSelectedOverrideId(overrides[0].id);
    if (selectedOverride) setOverrideBodyText(stringify(selectedOverride.body ?? {}));
  }, [selectedOverride?.id]);

  const updateSelectedOverride = (patch: Partial<OverrideRule>) => {
    if (!selectedOverride) return;
    setOverrides((items) => items.map((item) => item.id === selectedOverride.id ? { ...item, ...patch } : item));
  };

  const setNestedOverrideValue = (path: Array<string | number>, value: unknown) => {
    if (!parsedOverrideBody || typeof parsedOverrideBody !== "object" || !path.length) return;
    const root = JSON.parse(JSON.stringify(parsedOverrideBody)) as Record<string | number, unknown>;
    let current: Record<string | number, unknown> = root;
    path.slice(0, -1).forEach((key) => {
      current = current[key] as Record<string | number, unknown>;
    });
    current[path[path.length - 1]] = value;
    setOverrideBodyText(stringify(root));
  };

  const applyOverridesToPage = async (nextOverrides: OverrideRule[]) => {
    const webview = activeWebview();
    if (!webview?.executeJavaScript) return 0;
    await webview.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('__checkly_form_config__', { detail: ${JSON.stringify({ overrides: nextOverrides })} }))`,
    );
    return webview.executeJavaScript(`(() => {
      const clients = new Set();
      const seen = new Set();
      const roots = [];
      const elements = [document.documentElement, document.body, document.querySelector('#root'), ...Array.from(document.querySelectorAll('*')).slice(0, 2500)].filter(Boolean);
      for (const element of elements) {
        for (const key of Object.getOwnPropertyNames(element)) {
          if (key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$')) roots.push(element[key]);
        }
        if (roots.length > 12) break;
      }
      const inspect = (candidate) => {
        if (candidate && typeof candidate.getQueryCache === 'function' && typeof candidate.setQueryData === 'function') clients.add(candidate);
      };
      for (const initial of roots) {
        let root = initial;
        while (root?.return) root = root.return;
        const stack = [root];
        while (stack.length && seen.size < 30000) {
          const fiber = stack.pop();
          if (!fiber || seen.has(fiber)) continue;
          seen.add(fiber);
          inspect(fiber.memoizedProps?.client); inspect(fiber.pendingProps?.client);
          let hook = fiber.memoizedState;
          for (let index = 0; hook && index < 30; index += 1, hook = hook.next) {
            inspect(hook.memoizedState); inspect(hook.memoizedState?.client);
          }
          if (fiber.child) stack.push(fiber.child);
          if (fiber.sibling) stack.push(fiber.sibling);
        }
      }
      let invalidated = 0;
      for (const client of clients) {
        if (typeof client.invalidateQueries === 'function') { client.invalidateQueries({ refetchType: 'active' }); invalidated += 1; }
      }
      return invalidated;
    })()` ) as Promise<number>;
  };

  const saveOverride = async () => {
    if (!selectedOverride) return;
    try {
      const body = JSON.parse(overrideBodyText) as unknown;
      const updated = { ...selectedOverride, body, enabled: true };
      const next = overrides.map((item) => item.id === updated.id ? updated : item);
      setOverrides(next);
      const invalidated = await applyOverridesToPage(next);
      if (!invalidated) activeWebview()?.reload();
      showToast(invalidated ? "응답을 저장하고 활성 Query를 다시 조회했습니다." : "응답을 저장하고 현재 페이지를 새로고침했습니다.");
    } catch (error) {
      showToast(`응답 JSON을 확인해 주세요: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const resetOverride = async () => {
    if (!selectedOverride) return;
    const originalBody = selectedOverride.sourceBody ?? selectedOverride.body ?? {};
    const reset = { ...selectedOverride, body: originalBody, enabled: false };
    const next = overrides.map((item) => item.id === reset.id ? reset : item);
    setOverrides(next);
    setOverrideBodyText(stringify(originalBody));
    try {
      const invalidated = await applyOverridesToPage(next);
      if (!invalidated) activeWebview()?.reload();
      showToast("오버라이드를 초기화하고 서버 원본 응답을 다시 조회했습니다.");
    } catch {
      activeWebview()?.reload();
      showToast("오버라이드를 끄고 현재 페이지를 새로고침했습니다.");
    }
  };

  const createOverrideFromEvent = () => {
    if (!selectedEvent || !["fetch", "xhr"].includes(selectedEvent.type)) {
      showToast("먼저 네트워크 탭에서 수정할 API 응답을 선택해 주세요.");
      return;
    }
    if (selectedEvent.overridden) {
      showToast("이미 오버라이드된 응답입니다. 규칙을 끈 뒤 실제 API를 다시 호출해 주세요.");
      return;
    }
    let match = selectedEvent.url;
    try { match = new URL(selectedEvent.url, targetUrl).pathname; } catch { /* 원문 유지 */ }
    const method = String(selectedEvent.method || "GET").toUpperCase();
    const existing = overridesRef.current.find((item) =>
      item.method.toUpperCase() === method
      && normalizedEndpointPath(item.match) === normalizedEndpointPath(match));
    const next: OverrideRule = {
      ...existing,
      id: existing?.id || `override-live-${Date.now()}`,
      name: `라이브 응답 · ${method} ${match}`,
      match,
      method,
      status: Number(selectedEvent.status) || 200,
      enabled: false,
      body: selectedEvent.responseBody ?? {},
      sourceBody: selectedEvent.responseBody,
      sourceUrl: selectedEvent.url,
    };
    setOverrides((items) => [next, ...items.filter((item) => item.id !== next.id)]);
    setSelectedOverrideId(next.id);
    setOverrideEditing(true);
    setOverrideBodyText(stringify(next.body));
    setDrawerTab("override");
    showToast(existing ? "기존 규칙을 최신 실제 응답으로 갱신했습니다." : "실제 응답을 비활성 오버라이드로 복제했습니다.");
  };

  const deleteOverride = () => {
    if (!selectedOverride) return;
    const next = overrides.filter((item) => item.id !== selectedOverride.id);
    setOverrides(next);
    setSelectedOverrideId(next[0]?.id || "");
    setOverrideBodyText(stringify(next[0]?.body || {}));
    void applyOverridesToPage(next);
  };

  const autoCases = useMemo(() => detectedCases(discoveredFields), [discoveredFields]);
  const scopedCases = savedCases.filter(
    (item) => item.pageScope && pageScopeFromUrl(item.pageUrl || item.pageScope) === currentPageScope,
  );
  const availableCases = [...scopedCases, ...autoCases];
  const selectedCase = availableCases.find((item) => item.id === selectedCaseId);
  const draftIncludedFields = includedCaseFields(caseDraftFields, caseDraftExcludedFields);
  const draftFieldCount = Object.keys(draftIncludedFields).length;
  const visibleCases = caseFilter === "all"
    ? availableCases
    : availableCases.filter((item) => item.kind === caseFilter);
  const counts = availableCases.reduce(
    (result, item) => ({ ...result, [item.kind]: result[item.kind] + 1 }),
    { success: 0, failure: 0 },
  );

  useEffect(() => {
    if (selectedCase) return;
    setSelectedCaseId(availableCases[0]?.id ?? "");
  }, [availableCases, selectedCase]);

  useEffect(() => {
    setCaseDraftName(
      selectedCase ? (selectedCase.userSaved ? selectedCase.name : `${selectedCase.name} · 저장본`) : "",
    );
    setCaseDraftKind(selectedCase?.kind ?? "success");
    setCaseDraftFields(cloneFields(selectedCase?.fields));
    setCaseDraftExcludedFields(Array.isArray(selectedCase?.excludedFields) ? [...selectedCase.excludedFields] : []);
  }, [selectedCase?.id, JSON.stringify(selectedCase?.fields), JSON.stringify(selectedCase?.excludedFields)]);

  const hintKeys = drawerTab === "cases" ? (selectedCase?.fieldMeta ?? discoveredFields).map(field => caseDraftExcludedFields.includes(field.name) ? "" : field.name) : [];
  const hintSignature = JSON.stringify(hintKeys);
  useEffect(() => {
    if (activeTab?.state !== "ready") return;
    const webview = activeWebview();
    // Electron can throw synchronously when a guest is detaching during navigation.
    const updateHints = (keys: string[]) => Promise.resolve().then(() => webview?.executeJavaScript?.(highlightFieldsScript(keys))).catch(() => {});
    void updateHints(hintKeys);
    return () => { void updateHints([]); };
  }, [activeTab?.id, activeTab?.state, hintSignature]);

  const selectCase = (item: AutofillCase) => {
    if (item.id !== selectedCaseId) {
      setSelectedCaseId(item.id);
      setCaseDraftName(item.userSaved ? item.name : `${item.name} · 저장본`);
      setCaseDraftKind(item.kind);
      setCaseDraftFields(cloneFields(item.fields));
      setCaseDraftExcludedFields(Array.isArray(item.excludedFields) ? [...item.excludedFields] : []);
    }
    // Choosing a case only prepares its values; the explicit footer action applies them.
  };

  const saveCase = async () => {
    if (!selectedCase?.fieldMeta.length || !caseDraftName.trim()) {
      showToast(!selectedCase?.fieldMeta.length ? "저장할 자동 생성 필드가 없습니다." : "케이스 제목을 입력해 주세요.");
      return;
    }
    const id = selectedCase.userSaved ? selectedCase.id : `saved-case-${Date.now()}`;
    const next: AutofillCase = {
      ...selectedCase,
      id,
      name: caseDraftName.trim(),
      kind: caseDraftKind,
      generated: false,
      userSaved: true,
      pageScope: currentPageScope,
      pageUrl: currentPageUrl,
      savedAt: new Date().toISOString(),
      fields: cloneFields(caseDraftFields),
      excludedFields: caseDraftExcludedFields.filter((name) => Object.hasOwn(caseDraftFields, name)),
    };
    const saved = await setSavedCases((items) => items.some((item) => item.id === id)
      ? items.map((item) => item.id === id ? next : item)
      : [next, ...items]);
    if (!saved) { showToast("자동 입력 케이스를 저장하지 못했습니다. 다시 저장해 주세요."); return; }
    setSelectedCaseId(id);
    showToast(selectedCase.userSaved ? "수정한 자동 입력 값을 저장했습니다." : "새 자동 입력 케이스를 저장했습니다.");
  };

  const createCaseFromCurrentPage = async () => {
    const fields = await discoverFields(true);
    const webview = activeWebview();
    if (!fields.length || !webview?.executeJavaScript) { showToast("현재 화면에서 자동 입력할 필드를 찾지 못했습니다."); return; }
    try {
      const values = await webview.executeJavaScript(readCurrentFieldsScript(fields.map(field => field.name))) as Record<string, FieldValue>;
      const fieldMeta = fields.filter(field => Object.hasOwn(values, field.name));
      if (!fieldMeta.length) { showToast("현재 값을 읽을 수 있는 입력칸이 없습니다."); return; }
      const item: AutofillCase = { id: `saved-case-${Date.now()}`, name: `새 케이스 · ${pageScopeLabel(currentPageScope)}`, kind: "success", generated: false, userSaved: true, screen: pageScopeLabel(currentPageScope), fieldMode: "name", fields: values, fieldMeta, expected: "", pageScope: currentPageScope, pageUrl: currentPageUrl, savedAt: new Date().toISOString() };
      if (!await setSavedCases(items => [item, ...items])) { showToast("케이스를 저장하지 못했습니다. 다시 시도해 주세요."); return; }
      setCaseFilter("all"); setSelectedCaseId(item.id);
      showToast(`지금 화면 값으로 ${fieldMeta.length}칸을 저장했습니다.${fieldMeta.length < fields.length ? " 파일·날짜 팝업처럼 현재 값을 읽을 수 없는 칸은 제외했습니다." : ""}`);
    } catch (error) { showToast(`화면 값을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const deleteCase = async () => {
    if (!selectedCase?.userSaved) return;
    const saved = await setSavedCases((items) => items.filter((item) => item.id !== selectedCase.id));
    if (!saved) { showToast("자동 입력 케이스 삭제를 저장하지 못했습니다."); return; }
    setSelectedCaseId(autoCases[0]?.id ?? "");
    showToast("저장한 케이스를 삭제했습니다.");
  };

  const autofill = async (caseOverride?: AutofillCase) => {
    const item = caseOverride ?? selectedCase;
    const fields = caseOverride && caseOverride.id !== selectedCaseId
      ? includedCaseFields(caseOverride.fields, caseOverride.excludedFields)
      : draftIncludedFields;
    const webview = activeWebview();
    if (!webview?.executeJavaScript) {
      showToast("폼·검색 자동 입력은 Electron 앱에서 사용할 수 있습니다.");
      return;
    }
    if (!item) {
      showToast("먼저 현재 화면의 케이스를 선택해 주세요.");
      return;
    }
    if (!Object.keys(fields).length) {
      showToast("입력할 필드를 하나 이상 선택해 주세요.");
      return;
    }
    try {
      webview.focus();
      const result = await webview.executeJavaScript(fillFieldsScript(fields)) as FillResult;
      const webContentsId = webview.getWebContentsId();
      for (const entry of result.richText) {
        await webview.executeJavaScript(focusRichTextScript(entry.key));
        await window.electronAPI.insertFormAutomationText({ webContentsId, text: entry.value });
      }
      for (const entry of result.fileInputs) {
        await window.electronAPI.attachFormAutomationFixture({ webContentsId, ...entry });
      }
      for (const entry of result.dateTriggers) {
        const dateResult = await webview.executeJavaScript(
          selectDateRangeScript(entry.key, entry.value),
        ) as { selected: number; expected: number };
        if (!dateResult || dateResult.selected < dateResult.expected) {
          result.filled = result.filled.filter((key) => key !== entry.key);
          result.missing.push(`${entry.key}(날짜 선택 실패)`);
        }
      }
      showToast(
        result.filled.length
          ? `${item.name}: ${result.filled.length}개 필드에 값을 입력했습니다.${result.missing.length ? ` 미입력 ${result.missing.length}개` : ""}`
          : `일치하는 필드가 없습니다: ${result.missing.join(", ")}`,
      );
    } catch (error) {
      showToast(`자동 입력 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearAutofill = async () => {
    const webview = activeWebview();
    if (!webview?.executeJavaScript) {
      showToast("입력값 초기화는 Electron 앱에서 사용할 수 있습니다.");
      return;
    }
    if (!draftFieldCount) {
      showToast("초기화할 필드를 하나 이상 선택해 주세요.");
      return;
    }
    try {
      const result = await webview.executeJavaScript(
        clearFieldsScript(Object.keys(draftIncludedFields)),
      ) as { cleared: string[]; missing: string[] };
      showToast(
        result.cleared.length
          ? `${result.cleared.length}개 필드의 값을 초기화했습니다.`
          : `초기화할 필드가 없습니다: ${result.missing.join(", ")}`,
      );
    } catch (error) {
      showToast(`입력값 초기화 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const navigate = () => {
    if (!activeTab) return;
    let next = draftUrl.trim();
    if (!/^https?:\/\//i.test(next)) next = `https://${next}`;
    setTargetUrl(next);
    updateBrowserTab(activeTab.id, {
      url: next,
      currentPageUrl: next,
      state: "loading",
    });
  };

  const startInspectorResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const workbench = event.currentTarget.parentElement;
    const resize = (moveEvent: globalThis.MouseEvent) => {
      if (!workbench) return;
      const bounds = workbench.getBoundingClientRect();
      setInspectorWidth(Math.round(Math.min(620, Math.max(340, bounds.right - moveEvent.clientX))));
    };
    const stop = () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stop);
      document.body.classList.remove("resizing-form-inspector");
    };
    document.body.classList.add("resizing-form-inspector");
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stop);
  };


  const caseListResizeBounds = (handle: HTMLDivElement) => {
    const inspector = handle.closest(".fa-inspector");
    const list = handle.previousElementSibling as HTMLElement | null;
    const footer = inspector?.querySelector(".fa-inspector-footer");
    const values = inspector?.querySelector(".fa-values");
    if (!inspector || !list) return null;
    const currentHeight = list.getBoundingClientRect().height;
    const availableBelow = values?.getBoundingClientRect().height ??
      Math.max(0, inspector.getBoundingClientRect().bottom - handle.getBoundingClientRect().bottom - (footer?.getBoundingClientRect().height ?? 0));
    return { currentHeight, maximum: Math.max(48, currentHeight + availableBelow - (values ? 130 : 0)) };
  };

  const startCaseListResize = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const bounds = caseListResizeBounds(event.currentTarget);
    if (!bounds) return;
    event.preventDefault();
    const startY = event.clientY;
    const nextHeight = (clientY: number) => Math.round(Math.min(bounds.maximum, Math.max(48, bounds.currentHeight + clientY - startY)));
    const resize = (moveEvent: globalThis.MouseEvent) => setCaseListHeightPreview(nextHeight(moveEvent.clientY));
    const stop = (upEvent: globalThis.MouseEvent) => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stop);
      document.body.classList.remove("resizing-form-case-list");
      void setCaseListHeight(nextHeight(upEvent.clientY));
      setCaseListHeightPreview(null);
    };
    document.body.classList.add("resizing-form-case-list");
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stop);
  };

  const resizeCaseListWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const bounds = caseListResizeBounds(event.currentTarget);
    if (!bounds) return;
    event.preventDefault();
    const next = event.key === "Home" ? 48 : event.key === "End" ? bounds.maximum
      : bounds.currentHeight + (event.key === "ArrowDown" ? 24 : -24);
    void setCaseListHeight(Math.round(Math.min(bounds.maximum, Math.max(48, next))));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggedTabId;
    if (!sourceId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setBrowserTabs((items) => reorderBrowserSessions(
      items,
      sourceId,
      targetId,
      event.clientX > bounds.left + bounds.width / 2,
    ));
    setDraggedTabId(null);
    setDragOverTab(null);
  };

  if (!activeTab) return <div className="form-automation-page">브라우저 세션을 준비하는 중입니다.</div>;

  return (
    <div className="form-automation-page">
      <ScreenTestHeader mode={drawerTab} errors={activeErrorCount} overrides={overrides.filter(item => item.enabled).length}
        onMode={mode => { setDrawerTab(mode); if (mode === "cases" && !discoveredFields.length) void discoverFields(true); }}>
        <Button variant="ghost" onClick={() => setRecordingsOpen(true)} aria-label="브라우저 기록"><MaterialIcon name="history" /> 기록</Button>
        <Button variant="ghost" onClick={onNative}><MaterialIcon name="smartphone" /> 모바일 앱</Button>
        <Button variant="ghost" disabled={captureBusy} onClick={() => void startCapture()} aria-label="화면 캡처"
          aria-keyshortcuts="Control+Shift+S Meta+Shift+S" title="화면 캡처 (⌘/Ctrl + Shift + S)">
          <MaterialIcon name="photo_camera" /> {captureBusy ? "캡처 중…" : "캡처"}
        </Button>
      </ScreenTestHeader>

      <div
        className={`form-automation-workbench${focusMode ? " browser-focus" : ""}`}
        style={focusMode ? undefined : { gridTemplateColumns: `minmax(0, 1fr) 0px min(${inspectorWidth}px, 48vw)` }}
      >
        <section className="fa-browser-card">
          <div className="fa-session-bar">
            <div className="fa-session-tabs" role="tablist" aria-label="로그인 세션 브라우저 탭">
              {browserTabs.map((tab, index) => {
                const dragSide = dragOverTab?.id === tab.id
                  ? dragOverTab.placeAfter ? " drag-after" : " drag-before"
                  : "";
                return (
                  <div
                    className={`fa-session-tab${tab.id === activeTab.id ? " active" : ""}${draggedTabId === tab.id ? " dragging" : ""}${dragSide}`}
                    key={tab.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", tab.id);
                      setDraggedTabId(tab.id);
                    }}
                    onDragEnd={() => { setDraggedTabId(null); setDragOverTab(null); }}
                    onDragOver={(event) => {
                      if (!draggedTabId || draggedTabId === tab.id) return;
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      setDragOverTab({ id: tab.id, placeAfter: event.clientX > bounds.left + bounds.width / 2 });
                    }}
                    onDrop={(event) => handleDrop(event, tab.id)}
                  >

                    {editingTabId === tab.id ? (
                      <Input
                        autoFocus
                        aria-label={`${tab.name} 탭 이름`}
                        value={editingTabName}
                        maxLength={30}
                        onChange={(event) => setEditingTabName(event.target.value)}
                        onBlur={finishRenameBrowserTab}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            setEditingTabName(tab.name);
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      <Button
                        className="fa-session-main"
                        role="tab"
                        aria-selected={tab.id === activeTab.id}
                        onClick={() => switchBrowserTab(tab.id)}
                        onDoubleClick={() => { setEditingTabId(tab.id); setEditingTabName(tab.name); }}
                      >
                        <span className="fa-session-number">{index + 1}</span>
                        <span><strong>{tab.name}</strong><small>{BROWSER_IDENTITY_LABELS[tab.browserIdentity || "electron"]} · {urlHost(tab.currentPageUrl || tab.url)}</small></span>
                      </Button>
                    )}
                    {editingTabId !== tab.id && (
                      <Button variant="ghost" iconOnly
                        className="fa-tab-icon"
                        aria-label={`${tab.name} 이름 수정`}
                        onClick={() => { setEditingTabId(tab.id); setEditingTabName(tab.name); }}
                      ><MaterialIcon name="edit" /></Button>
                    )}
                    {browserTabs.length > 1 && editingTabId !== tab.id && (
                      <Button variant="ghost" iconOnly className="fa-tab-icon" aria-label={`${tab.name} 닫기`} onClick={() => closeBrowserTab(tab.id)}>
                        <MaterialIcon name="close" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <Popover label="새 세션" className="fa-session-new" triggerClassName="fa-session-add" triggerText={<MaterialIcon name="add" />}>
              <label className="fa-view-field">브라우저<select aria-label="새 세션 브라우저 식별" value={newSessionIdentity} onChange={event => setNewSessionIdentity(event.target.value as BrowserIdentity)}>
                {Object.entries(BROWSER_IDENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <Button variant="primary" onClick={() => addBrowserTab(newSessionIdentity)} disabled={browserTabs.length >= MAX_FORM_SESSIONS}>새 세션 열기</Button>
            </Popover>
            <Button className="fa-split-toggle" aria-pressed={Boolean(splitTabIds)} disabled={browserTabs.length < 2} onClick={toggleBrowserSplit}
              title={browserTabs.length < 2 ? "세션을 두 개 이상 열면 화면을 분할할 수 있습니다." : "두 세션 나란히 보기"}>
              <MaterialIcon name="vertical_split" /> {splitTabIds ? "분할 해제" : "화면 분할"}
            </Button>
          </div>
          <div className="fa-browser-toolbar">
            <div className="fa-browser-actions">
              <Button variant="ghost" iconOnly disabled={!activeTab.history.back} onClick={() => activeWebview()?.goBack()} aria-label="뒤로가기"><MaterialIcon name="arrow_back" /></Button>
              <Button variant="ghost" iconOnly disabled={!activeTab.history.forward} onClick={() => activeWebview()?.goForward()} aria-label="앞으로가기"><MaterialIcon name="arrow_forward" /></Button>
              <Button variant="ghost" iconOnly onClick={() => activeWebview()?.reload()} aria-label="새로고침" title="새로고침 (⌘R / Ctrl+R)"><MaterialIcon name={activeTab.state === "loading" ? "progress_activity" : "refresh"} /></Button>
            </div>
            <form className="fa-address-bar" onSubmit={event => { event.preventDefault(); navigate(); }}>
              <Input mono leading={<MaterialIcon name="lock" />} value={draftUrl} onChange={event => setDraftUrl(event.target.value)} aria-label="대상 사이트 주소"
                trailing={<span className={`fa-status ${activeTab.state}`}>{activeTab.state === "ready" ? "연결됨" : activeTab.state === "error" ? "연결 실패" : "로딩 중"}</span>} />
            </form>
            <Popover label="보기 설정" className="fa-view-menu" triggerClassName="fa-view-trigger" panelClassName="fa-view-panel"
              triggerText={<><MaterialIcon name="tune" /> 보기 <small>{zoomPercent}%</small></>}>
              <label className="fa-view-field">브라우저<select aria-label="현재 세션 브라우저 식별" value={activeTab.browserIdentity || "electron"} onChange={event => changeBrowserIdentity(event.target.value as BrowserIdentity)}>
                {Object.entries(BROWSER_IDENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select><small>브라우저 식별 정보 · 렌더링 엔진은 Chromium</small></label>
              <label className="fa-view-field">화면 크기<select aria-label="미리보기 화면 크기" value={viewport.id} onChange={event => changeViewport(event.target.value)}>
                {VIEWPORT_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select></label>
              {Boolean(viewport.width) && <div className="fa-view-row"><span>{viewportWidth} × {viewportHeight}</span><Button variant="ghost" onClick={() => setLandscape(value => !value)} aria-label="가로·세로 전환"><MaterialIcon name="screen_rotation" /> 회전</Button></div>}
              <div className="fa-view-row"><strong>확대</strong><div className="fa-zoom" aria-label="브라우저 화면 배율">
                <Button variant="secondary" iconOnly aria-label="화면 축소" disabled={zoomPercent <= 50} onClick={() => setZoomPercent(value => Math.max(50, value - 5))}><MaterialIcon name="remove" /></Button>
                <Button className="fa-zoom-value" title="100%로 초기화" onClick={() => setZoomPercent(100)}>{zoomPercent}%</Button>
                <Button variant="secondary" iconOnly aria-label="화면 확대" disabled={zoomPercent >= 125} onClick={() => setZoomPercent(value => Math.min(125, value + 5))}><MaterialIcon name="add" /></Button>
              </div></div>
              <div className="fa-view-actions"><Button variant="secondary" onClick={openBrowserDevTools}><MaterialIcon name="code" /> 개발자 도구</Button>
                <Button variant="secondary" onClick={() => setFocusMode(value => !value)}><MaterialIcon name={focusMode ? "close_fullscreen" : "open_in_full"} />{focusMode ? "패널 열기" : "크게 보기"}</Button></div>
            </Popover>
          </div>

          <div
            className={`fa-browser-panes${splitTabIds ? " split" : ""}${splitResize.resizing ? " resizing" : ""}`}
            style={splitTabIds ? { gridTemplateColumns: `minmax(0, ${splitResize.ratio}fr) 6px minmax(0, ${1 - splitResize.ratio}fr)` } : undefined}
          >
            {browserTabs.map((tab) => {
              const paneIndex = splitTabIds?.indexOf(tab.id) ?? -1;
              const visible = splitTabIds ? paneIndex >= 0 : tab.id === activeTab.id;
              const side = paneIndex < 0 ? tab.name : paneIndex === 0 ? "왼쪽" : "오른쪽";
              return (
                <section
                  key={tab.id}
                  className={`fa-browser-pane${visible ? " visible" : ""}${tab.id === activeTab.id ? " selected" : ""}${paneIndex === 1 ? " right" : ""}`}
                  style={{ order: paneIndex * 2 }}
                  aria-label={splitTabIds && visible ? `${side} 브라우저` : tab.name}
                >
                  <div className="fa-pane-toolbar" hidden={!splitTabIds}>
                    <Button
                      variant="ghost"
                      aria-label={`${side} 화면 선택`}
                      aria-pressed={tab.id === activeTab.id}
                      onClick={() => switchBrowserTab(tab.id)}
                    >
                      <MaterialIcon name={tab.id === activeTab.id ? "radio_button_checked" : "radio_button_unchecked"} />
                      {side}
                    </Button>
                    <select aria-label={`${side} 화면 세션`} value={tab.id} onChange={(event) => selectSplitSession(paneIndex, event.target.value)}>
                      {browserTabs.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
                    </select>
                    <span className="fa-pane-url" title={tab.currentPageUrl || tab.url}>{tab.currentPageUrl || tab.url}</span>
                  </div>
                  <div className={`fa-browser-surface${viewport.width ? " responsive" : ""}`}>
                    {/* Keep each guest in the same keyed parent so splitting never reloads its session. */}
                    <div className="fa-viewport-frame" style={viewport.width ? { width: viewportWidth * zoomFactor, height: viewportHeight * zoomFactor } : undefined}>
                      <webview
                        className={`fa-webview${visible ? " visible" : ""}${tab.id === activeTab.id ? " active" : ""}`}
                        style={viewport.width ? { width: viewportWidth, height: viewportHeight, transform: `scale(${zoomFactor})`, transformOrigin: "top left" } : undefined}
                        ref={webviewRefFor(tab.id)}
                        src={tab.url}
                        partition={browserSessionPartition(tab.id)}
                        useragent={browserUserAgent(tab.browserIdentity || "electron", navigator.userAgent, viewport.id.startsWith("mobile"))}
                        // React types declare a boolean, but React omits true for this DOM attribute.
                        // Electron requires the attribute to be present, so emit an empty string.
                        allowpopups={"" as unknown as boolean}
                      />
                    </div>
                    {tab.state === "error" && (
                      <div className="fa-browser-overlay" role="alert">
                        <MaterialIcon name="wifi_off" />
                        <strong>페이지를 불러오지 못했습니다</strong>
                        <span>{urlHost(tab.currentPageUrl || tab.url)}</span>
                        <Button variant="secondary" onClick={() => webviewRefs.current.get(tab.id)?.reload()}><MaterialIcon name="refresh" /> 다시 시도</Button>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
            {splitTabIds && <div
              className="fa-split-resizer"
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="분할 화면 너비 조절"
              title="드래그해 너비 조절 · 더블클릭 반반 · 방향키로 조절"
              {...splitResize.separatorProps}
            ><span /></div>}
            {!window.electronAPI && (
              <div className="fa-electron-only" role="note">
                <b>ELECTRON ONLY</b>
                <span>자동 입력은 Electron 앱에서만 동작합니다. 이 환경에서는 화면 구성만 확인할 수 있습니다.</span>
              </div>
            )}
          </div>
        </section>

        <div
          className="fa-inspector-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="검사 패널 너비 조절"
          title="드래그해 너비 조절 · 더블클릭 기본 너비"
          onMouseDown={startInspectorResize}
          onDoubleClick={() => setInspectorWidth(440)}
        ><span /></div>

        <aside className={`fa-inspector fa-mode-${drawerTab}`} aria-label="검사 패널">
          {drawerTab === "network" ? (
            <NetworkPanel
              events={activeNetworkEvents}
              selectedEvent={activeSelectedEvent}
              spec={activeSelectedEvent ? specForNetworkEvent(sharedOpenApi.sources, activeSelectedEvent, eventSpecSources[activeSelectedEvent.id]) : undefined}
              specLoading={sharedOpenApi.loading}
              specSources={sharedOpenApi.sources}
              specErrors={sharedOpenApi.errors}
              selectedSpecSource={activeSelectedEvent ? eventSpecSources[activeSelectedEvent.id] || "" : ""}
              onSpecSource={source => { if (activeSelectedEvent) setEventSpecSources(current => ({ ...current, [activeSelectedEvent.id]: source })); }}
              onRefreshSpec={sharedOpenApi.refresh}
              onCopyUrl={url => { void copyText(url, "요청 URL을 복사했습니다."); }}
              filter={networkFilter}
              activeSessionName={activeTab.name}
              onSelect={setSelectedEvent}
              onBack={() => setSelectedEvent(null)}
              onFilter={setNetworkFilter}
              onCopy={copyApiEvent}
              onCreateOverride={createOverrideFromEvent}
              onClear={() => void clearSessionLog()}
              onDownload={() => void downloadSessionLog()}
            />
          ) : drawerTab === "override" ? (
            <OverridePanel
              openApi={openApi}
              overrides={overrides}
              selected={selectedOverride}
              bodyText={overrideBodyText}
              editorMode={overrideEditorMode}
              status={overrideStatus}
              schema={selectedOverrideSchema}
              parsedBody={parsedOverrideBody}
              onSelect={setSelectedOverrideId}
              onUpdate={updateSelectedOverride}
              onBodyText={setOverrideBodyText}
              onEditorMode={setOverrideEditorMode}
              onFieldChange={setNestedOverrideValue}
              editing={overrideEditing} onEditing={setOverrideEditing}
              onToggleRule={(id, enabled) => { void (async () => {
                const next = overrides.map(rule => rule.id === id ? { ...rule, enabled } : rule);
                if (!await setOverrides(next)) { showToast("규칙 변경을 저장하지 못했습니다."); return; }
                await applyOverridesToPage(next);
              })().catch(error => showToast(`응답 적용 실패: ${String(error)}`)); }}
              onCreateBlank={() => { void (async () => {
                const rule: OverrideRule = { id: `override-${Date.now()}`, name: "새 응답", match: "/api/example", method: "GET", status: 200, enabled: false, body: { status: "success", message: "", data: {} } };
                if (!await setOverrides(items => [rule, ...items])) { showToast("새 규칙을 저장하지 못했습니다."); return; }
                setSelectedOverrideId(rule.id); setOverrideBodyText(stringify(rule.body)); setOverrideEditing(true);
              })().catch(error => showToast(`규칙 생성 실패: ${String(error)}`)); }}
              onChooseResponse={() => { setSelectedEvent(null); setDrawerTab("network"); }}
              onSave={() => void saveOverride()}
              onReset={() => void resetOverride()}
              onDelete={deleteOverride}
            />
          ) : (
            <>
          <div className="fa-form-scroll" data-ck-scroll="light">
          {showGuide && <section className="fa-onboarding">
            <MaterialIcon name="waving_hand" /><div><strong>폼 입력은 3단계면 끝나요</strong><p>{discoveredFields.length ? "왼쪽 화면의 입력칸을 찾아 두었어요. 케이스를 고르고 입력 버튼을 누르세요." : "왼쪽에 테스트할 화면을 열고 입력칸을 찾아 주세요. 케이스를 고르면 한 번에 입력할 수 있어요."}</p></div>
            <Button variant="ghost" iconOnly aria-label="폼 입력 안내 닫기" onClick={() => setShowGuide(false)}><MaterialIcon name="close" /></Button>
            <ol>{["입력칸 찾기", "케이스 고르기", "입력하기"].map((label, index) => <li key={label}><b className={index === 0 && discoveredFields.length ? "done" : ""}>{index === 0 && discoveredFields.length ? "✓" : index + 1}</b>{label}</li>)}</ol>
          </section>}
          <section className="fa-form-step">
            <div className="fa-step-heading"><b className={`fa-step-number${discoveredFields.length ? " done" : ""}`}>{discoveredFields.length ? "✓" : "1"}</b><strong>입력칸 찾기</strong><code title={currentPageScope}>{pageScopeLabel(currentPageScope)}</code><Button variant="ghost" onClick={() => void discoverFields(true)}><MaterialIcon name="refresh" /> 다시 찾기</Button></div>
            <div className="fa-field-chips">{discoveredFields.map((field, index) => <span key={field.name}><b>{index + 1}</b>{field.label || field.name}</span>)}</div>
          </section>
          <section className="fa-form-step">
          <div className="fa-step-heading"><b className="fa-step-number active">2</b><strong>케이스 고르기</strong>
            <div className="fa-case-filters" role="group" aria-label="케이스 유형 필터">
              <Button aria-pressed={caseFilter === "all"} onClick={() => setCaseFilter("all")}>전체 {availableCases.length}</Button>
              <Button aria-pressed={caseFilter === "success"} onClick={() => setCaseFilter("success")}>정상 {counts.success}</Button>
              <Button aria-pressed={caseFilter === "failure"} onClick={() => setCaseFilter("failure")}>오류 {counts.failure}</Button>
            </div>
          </div>
          <div className="fa-case-list" style={caseListHeightPreview !== null || caseListHeight !== null
            ? { height: caseListHeightPreview ?? caseListHeight ?? undefined, maxHeight: "none" }
            : undefined}>
            {visibleCases.length ? visibleCases.map((item) => (
              <Button
                key={item.id}
                aria-pressed={selectedCaseId === item.id}
                className={`fa-case-card ${item.kind}${item.generated ? " detected" : ""}${selectedCaseId === item.id ? " selected" : ""}`}
                onClick={() => selectCase(item)}
              >
                <span className="fa-case-radio" aria-hidden="true" />
                <span><strong>{item.name}</strong><small>{item.fieldMeta.slice(0, 3).map(field => {
                  const value = item.fields[field.name];
                  if (value === "" || value == null) return "(빈 값)";
                  if (field.type === "password") return "••••••";
                  if (typeof value === "boolean") return `${field.label || field.name} ${value ? "✓" : "해제"}`;
                  if (Array.isArray(value)) return value.join(", ");
                  if (typeof value === "object") return "__qaFile" in value ? "첨부 파일" : `${value.start} ~ ${value.end}`;
                  return value;
                }).join(" · ")}</small></span>
                <span className="fa-case-badges"><b>{item.kind === "success" ? "정상" : "오류값"}</b></span>
              </Button>
            )) : (
              <div className="fa-case-empty"><MaterialIcon name="auto_awesome" /><strong>현재 화면에 자동 입력 케이스가 없습니다</strong><span>입력 화면을 연 뒤 다시 감지해 주세요.</span></div>
            )}
          </div>
          <div
            className="fa-case-list-resizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label="자동 입력 케이스 목록 높이 조절"
            tabIndex={0}
            title="위아래로 드래그해서 케이스 목록 높이 조절 · 더블클릭해서 초기화"
            onMouseDown={startCaseListResize}
            onKeyDown={resizeCaseListWithKeyboard}
            onDoubleClick={() => { void setCaseListHeight(null); setCaseListHeightPreview(null); }}
          ><MaterialIcon name="drag_handle" /></div>

          <Button className="fa-new-case" onClick={() => void createCaseFromCurrentPage()}><MaterialIcon name="add" /> 지금 화면 값으로 새 케이스</Button>
          </section>
          {selectedCase && (
            <div className="fa-values">
              <div className="fa-step-heading"><b className="fa-step-number">3</b><strong>값 확인하고 입력</strong><small>체크한 칸만 바뀌어요</small><Popover label="케이스 설정" triggerClassName="fa-more-trigger" triggerText={<MaterialIcon name="more_horiz" />}>
              <div className="fa-case-meta">
                <label><span>케이스 제목</span><Input maxLength={80} value={caseDraftName} onChange={(event) => setCaseDraftName(event.target.value)} /></label>
                <label><span>케이스 유형</span><select value={caseDraftKind} onChange={(event) => setCaseDraftKind(event.target.value as "success" | "failure")}><option value="success">성공 · 정상값</option><option value="failure">실패 · 오류값</option></select></label>
              </div>
              <div className="fa-field-selection-tools">
                <span>체크 해제한 필드는 변경하지 않습니다.</span>
                <div>
                  <Button variant="ghost" onClick={() => setCaseDraftExcludedFields([])} disabled={draftFieldCount === selectedCase.fieldMeta.length}>전체 선택</Button>
                  <Button variant="ghost" onClick={() => setCaseDraftExcludedFields(selectedCase.fieldMeta.map((field) => field.name))} disabled={!draftFieldCount}>전체 해제</Button>
                </div>
              </div>
              </Popover></div>
              <div className="fa-value-table">{selectedCase.fieldMeta.map((field, index) => (
                <div className={`fa-value-row${caseDraftExcludedFields.includes(field.name) ? " is-excluded" : ""}`} key={field.name}>
                  <input
                    className="fa-value-include"
                    type="checkbox"
                    aria-label={`${field.label || field.name} 자동 입력`}
                    title={`${field.label || field.name} 자동 입력 여부`}
                    checked={!caseDraftExcludedFields.includes(field.name)}
                    onChange={(event) => setCaseDraftExcludedFields((current) => event.target.checked
                      ? current.filter((name) => name !== field.name)
                      : [...current, field.name])}
                  />
                  <span className="fa-field-info" title={field.name}><b className="fa-field-number">{index + 1}</b><strong>{field.label || field.name}{field.required ? " *" : ""}</strong></span>
                  <div className="fa-value-control">
                    <CaseValueInput
                      field={field}
                      value={caseDraftFields[field.name]}
                      disabled={caseDraftExcludedFields.includes(field.name)}
                      onChange={(value) => setCaseDraftFields((current) => ({ ...current, [field.name]: value }))}
                    />
                  </div>
                </div>
              ))}</div>
              <div className="fa-values-actions">
                {selectedCase.userSaved && <Button variant="ghost" className="danger" onClick={deleteCase}><MaterialIcon name="delete" /> 삭제</Button>}
                <Button variant="ghost" onClick={() => { setCaseDraftName(selectedCase.userSaved ? selectedCase.name : `${selectedCase.name} · 저장본`); setCaseDraftKind(selectedCase.kind); setCaseDraftFields(cloneFields(selectedCase.fields)); setCaseDraftExcludedFields(Array.isArray(selectedCase.excludedFields) ? [...selectedCase.excludedFields] : []); }}><MaterialIcon name="restore" /> 원래 값으로</Button>
                <Button variant="ghost" className="save" onClick={saveCase}><MaterialIcon name="save" /> 케이스에 저장</Button>
              </div>
            </div>
          )}

          </div>
          <div className="fa-inspector-footer">
            <Button variant="primary" size="large" onClick={() => void autofill()} disabled={!draftFieldCount}><MaterialIcon name="auto_fix_high" /> {draftFieldCount ? `${draftFieldCount}칸 입력하기` : "입력할 칸을 체크하세요"}</Button>
            <Button variant="secondary" size="large" iconOnly aria-label="선택 필드 초기화" title="체크한 칸 비우기" onClick={() => void clearAutofill()} disabled={!draftFieldCount}><MaterialIcon name="ink_eraser" /></Button>
          </div>
            </>
          )}
        </aside>
      </div>
      {toast && <div className="toast"><span className="toast-dot" />{toast}</div>}
      {recordingsOpen && <SessionRecordingsDialog onClose={closeRecordings} />}
      {capture && <ScreenshotEditor capture={capture} onCancel={() => setCapture(null)} onCopy={copyCapture} />}
    </div>
  );
};
