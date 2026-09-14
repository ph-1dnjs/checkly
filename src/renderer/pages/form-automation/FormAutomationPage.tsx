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
  discoverFieldsScript,
  fillFieldsScript,
  focusRichTextScript,
  selectDateRangeScript,
} from "./browserScripts";
import {
  MAX_FORM_SESSIONS,
  browserSessionPartition,
  caseValueCount,
  cloneFields,
  defaultBrowserSession,
  detectedCases,
  normalizeBrowserSessions,
  pageScopeFromUrl,
  pageScopeLabel,
  reorderBrowserSessions,
  type AutofillCase,
  type BrowserSession,
  type DateRangeValue,
  type DetectedField,
  type FieldValue,
  type FileValue,
} from "./model";
import { NetworkPanel, OverridePanel, StoragePanel } from "./InspectorPanels";
import { OpenApiDialog } from "./OpenApiDialog";
import { ScreenshotEditor, type ScreenshotCapture } from "./ScreenshotEditor";
import {
  EMPTY_STORAGE_SNAPSHOT,
  apiEventClipboardText,
  browserStorageScript,
  contractForEvent,
  isSessionError,
  normalizedEndpointPath,
  overrideResponseSchema,
  safeJson,
  stringify,
  type NetworkEvent,
  type OpenApiDocument,
  type OverrideRule,
  type StorageItem,
  type StorageSnapshot,
} from "./liveQa";

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

const MaterialIcon = ({ name }: { name: string }): ReactElement => (
  <span className="msi" aria-hidden="true">{name}</span>
);

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const useStoredState = <T,>(key: string, fallback: T) => {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));
  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
};

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
  onChange,
}: {
  field: DetectedField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}) => {
  if (field.type === "date-trigger" && isDateRange(value)) {
    return (
      <div className="fa-date-range">
        <input
          aria-label={`${field.label || field.name} 시작일`}
          type="date"
          value={value.start}
          onChange={(event) => onChange({ ...value, start: event.target.value })}
        />
        <span>~</span>
        <input
          aria-label={`${field.label || field.name} 종료일`}
          type="date"
          value={value.end}
          onChange={(event) => onChange({ ...value, end: event.target.value })}
        />
      </div>
    );
  }
  if (field.type === "file" && isFileValue(value)) {
    return (
      <select
        aria-label={`${field.label || field.name} 파일 케이스`}
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
  if (field.type === "select-multiple" || Array.isArray(value)) {
    return (
      <input
        aria-label={`${field.label || field.name} 값`}
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
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const inputType = ["date", "datetime-local", "email", "month", "number", "password", "tel", "time", "url"].includes(field.type)
    ? field.type
    : "text";
  return (
    <input
      aria-label={`${field.label || field.name} 값`}
      type={inputType}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};

export const FormAutomationPage = (): ReactElement => {
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
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<{ id: string; placeAfter: boolean } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useStoredState("checkly-form-inspector-width", 420);
  const [networkListHeight, setNetworkListHeight] = useStoredState("checkly-form-network-list-height", 305);
  const [discoveredFields, setDiscoveredFields] = useState<DetectedField[]>([]);
  const [discoveryStatus, setDiscoveryStatus] = useState("현재 화면의 폼과 검색 필드를 자동으로 찾습니다.");
  const [savedCases, setSavedCases] = useStoredState<AutofillCase[]>("checkly-form-saved-cases", []);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [caseFilter, setCaseFilter] = useState<"all" | "success" | "failure">("all");
  const [caseDraftName, setCaseDraftName] = useState("");
  const [caseDraftKind, setCaseDraftKind] = useState<"success" | "failure">("success");
  const [caseDraftFields, setCaseDraftFields] = useState<Record<string, FieldValue>>({});
  const [drawerTab, setDrawerTab] = useState<"network" | "cases" | "storage" | "override">("network");
  const [networkEvents, setNetworkEvents] = useState<NetworkEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<NetworkEvent | null>(null);
  const [networkFilter, setNetworkFilter] = useState<"all" | "errors">("all");
  const [storageBucket, setStorageBucket] = useState<"localStorage" | "sessionStorage" | "cookies">("localStorage");
  const [storageQuery, setStorageQuery] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageSnapshot, setStorageSnapshot] = useState<StorageSnapshot>(EMPTY_STORAGE_SNAPSHOT);
  const [overrides, setOverrides] = useStoredState<OverrideRule[]>("checkly-form-overrides", []);
  const [selectedOverrideId, setSelectedOverrideId] = useState("");
  const [overrideBodyText, setOverrideBodyText] = useState("{}");
  const [overrideEditorMode, setOverrideEditorMode] = useState<"fields" | "json">("fields");
  const [openApi, setOpenApi] = useStoredState<OpenApiDocument | null>("checkly-form-openapi", null);
  const [openApiDialog, setOpenApiDialog] = useState(false);
  const [capture, setCapture] = useState<ScreenshotCapture | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [zoomPercent, setZoomPercent] = useStoredState("checkly-form-browser-zoom", 80);
  const [toast, setToast] = useState("");
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
    const payload: NetworkEvent = {
      ...eventPayload,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      browserSessionId: browserSession.id,
      browserSessionName: browserSession.name,
      contract: ["fetch", "xhr"].includes(eventPayload.type)
        ? contractForEvent(openApi, { ...eventPayload, id: "contract-check" } as NetworkEvent)
        : {
          tone: "danger",
          label: "페이지 오류",
          detail: eventPayload.error || "페이지에서 오류가 발생했습니다.",
        },
    };
    setNetworkEvents((items) => [payload, ...items].slice(0, 1000));
    void window.electronAPI?.saveFormAutomationSessionEvent?.(payload).catch(() => undefined);
    if (activeTabIdRef.current === browserSession.id)
      setSelectedEvent((current) => current || payload);
  }, [openApi]);

  useEffect(() => {
    void window.electronAPI?.readFormAutomationSessionEvents?.(1000)
      .then((items) => setNetworkEvents((current) => current.length ? current : items as NetworkEvent[]))
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

  const discoverFields = useCallback(async (selectDefault = false) => {
    const webview = activeWebview();
    if (!webview?.executeJavaScript) {
      setDiscoveryStatus("필드 자동 감지는 Electron 앱에서 사용할 수 있습니다.");
      return [];
    }
    setDiscoveryStatus("현재 화면에서 name, 라벨과 검색 영역을 읽는 중입니다.");
    try {
      const fields = await webview.executeJavaScript(discoverFieldsScript) as DetectedField[];
      setDiscoveredFields(fields);
      const searchCount = fields.filter((field) => field.context === "search").length;
      setDiscoveryStatus(
        fields.length
          ? `${fields.length}개 필드를 감지했습니다.${searchCount ? ` 검색 조건 ${searchCount}개가 포함됩니다.` : ""} 케이스를 누르면 즉시 입력됩니다.`
          : "현재 화면에서 입력 가능한 폼 또는 검색 필드를 찾지 못했습니다.",
      );
      if (selectDefault && fields.length) setSelectedCaseId(detectedCases(fields)[0]?.id ?? "");
      return fields;
    } catch (error) {
      setDiscoveryStatus(`필드 감지 실패: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }, []);

  const switchBrowserTab = useCallback((tabId: string) => {
    const tab = browserTabsRef.current.find((item) => item.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);
    const url = currentWebviewUrl(webviewRefs.current.get(tabId) ?? null, tab.currentPageUrl || tab.url);
    setDraftUrl(url);
    setTargetUrl(url);
    setDiscoveredFields([]);
    setDiscoveryStatus("현재 세션 화면의 폼과 검색 필드를 자동으로 찾습니다.");
  }, [setActiveTabId, setTargetUrl]);

  const addBrowserTab = useCallback(() => {
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
      url,
      currentPageUrl: url,
      state: "loading",
      history: { back: false, forward: false },
    };
    setBrowserTabs((current) => [...current, next]);
    setActiveTabId(id);
    setDraftUrl(url);
    setTargetUrl(url);
    setEditingTabId(id);
    setEditingTabName(next.name);
    setDiscoveredFields([]);
  }, [activeTab?.url, setActiveTabId, setBrowserTabs, setTargetUrl, showToast, targetUrl]);

  const closeBrowserTab = (tabId: string) => {
    const items = browserTabsRef.current;
    if (items.length <= 1) return;
    const index = items.findIndex((item) => item.id === tabId);
    const next = items.filter((item) => item.id !== tabId);
    setBrowserTabs(next);
    webviewRefs.current.delete(tabId);
    if (activeTabIdRef.current === tabId)
      switchBrowserTab(next[Math.min(index, next.length - 1)].id);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        addBrowserTab();
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
  }, [addBrowserTab, switchBrowserTab]);

  const tabIds = browserTabs.map((item) => item.id).join("|");
  useEffect(() => {
    const factor = Math.min(1.25, Math.max(0.5, Number(zoomPercent) / 100));
    for (const webview of webviewRefs.current.values()) {
      try { webview.setZoomFactor(factor); } catch { /* Electron 웹뷰 준비 전 */ }
    }
  }, [tabIds, zoomPercent]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const tabId of tabIds.split("|").filter(Boolean)) {
      const webview = webviewRefs.current.get(tabId);
      if (!webview) continue;
      let discoveryTimer = 0;
      const sessionForTab = () => browserTabsRef.current.find((item) => item.id === tabId)
        ?? defaultBrowserSession(browserTabsRef.current[0]?.url || DEFAULT_URL);
      const isActive = () => activeTabIdRef.current === tabId;
      const updateHistory = () => {
        try {
          updateBrowserTab(tabId, {
            history: { back: webview.canGoBack(), forward: webview.canGoForward() },
          });
        } catch {
          updateBrowserTab(tabId, { history: { back: false, forward: false } });
        }
      };
      const ready = () => {
        const url = currentWebviewUrl(webview, sessionForTab().url);
        updateBrowserTab(tabId, { state: "ready", url, currentPageUrl: url });
        try { webview.setZoomFactor(Math.min(1.25, Math.max(0.5, Number(zoomPercent) / 100))); } catch { /* 웹뷰 준비 전 */ }
        sendGuestConfig();
        updateHistory();
        if (isActive()) {
          setDraftUrl(url);
          setTargetUrl(url);
          window.clearTimeout(discoveryTimer);
          discoveryTimer = window.setTimeout(() => void discoverFields(true), 350);
        }
      };
      const loading = () => {
        loadStartedAtRef.current.set(tabId, Date.now());
        updateBrowserTab(tabId, { state: "loading" });
        if (isActive()) setDiscoveredFields([]);
      };
      const failed = () => updateBrowserTab(tabId, { state: "error" });
      const navigated = (event: Event & { url?: string }) => {
        const url = event.url || currentWebviewUrl(webview, sessionForTab().url);
        updateBrowserTab(tabId, { url, currentPageUrl: url });
        updateHistory();
        if (isActive()) {
          setDraftUrl(url);
          setTargetUrl(url);
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
        if (event.channel !== "form-automation:network-event") return;
        recordGuestNetworkEvent(event.args?.[0] as Omit<NetworkEvent, "id">, sessionForTab());
      };
      webview.addEventListener("dom-ready", ready);
      webview.addEventListener("did-stop-loading", ready);
      webview.addEventListener("did-start-loading", loading);
      webview.addEventListener("did-fail-load", failed);
      webview.addEventListener("did-navigate", navigated as EventListener);
      webview.addEventListener("did-navigate-in-page", navigated as EventListener);
      webview.addEventListener("ipc-message", message as EventListener);
      cleanups.push(() => {
        window.clearTimeout(discoveryTimer);
        webview.removeEventListener("dom-ready", ready);
        webview.removeEventListener("did-stop-loading", ready);
        webview.removeEventListener("did-start-loading", loading);
        webview.removeEventListener("did-fail-load", failed);
        webview.removeEventListener("did-navigate", navigated as EventListener);
        webview.removeEventListener("did-navigate-in-page", navigated as EventListener);
        webview.removeEventListener("ipc-message", message as EventListener);
      });
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [discoverFields, recordGuestNetworkEvent, sendGuestConfig, setTargetUrl, tabIds, updateBrowserTab, zoomPercent]);

  const currentPageUrl = activeTab?.currentPageUrl || activeTab?.url || targetUrl;
  const currentPageScope = pageScopeFromUrl(currentPageUrl);
  const activeNetworkEvents = networkEvents.filter((event) =>
    event.browserSessionId ? event.browserSessionId === activeTab?.id : activeTab?.id === "default");
  const activeErrorCount = activeNetworkEvents.filter(isSessionError).length;
  const storageIsCurrent = storageSnapshot.browserSessionId === activeTab?.id;
  const storageTotal = storageIsCurrent
    ? storageSnapshot.localStorage.items.length
      + storageSnapshot.sessionStorage.items.length
      + storageSnapshot.cookies.length
    : 0;

  useEffect(() => {
    setNetworkEvents((items) => items.map((item) => (
      ["fetch", "xhr"].includes(item.type)
        ? { ...item, contract: contractForEvent(openApi, item) }
        : item
    )));
  }, [openApi]);

  const refreshBrowserStorage = useCallback(async () => {
    const webview = activeWebview();
    const sessionId = activeTabIdRef.current;
    if (!webview?.executeJavaScript) {
      showToast("세션 저장소는 Electron 앱에서 확인할 수 있습니다.");
      return;
    }
    setStorageBusy(true);
    try {
      const snapshot = await webview.executeJavaScript(browserStorageScript) as Omit<StorageSnapshot, "browserSessionId">;
      if (activeTabIdRef.current === sessionId)
        setStorageSnapshot({ ...snapshot, browserSessionId: sessionId });
    } catch (error) {
      showToast(`세션 저장소를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (activeTabIdRef.current === sessionId) setStorageBusy(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (drawerTab === "storage") void refreshBrowserStorage();
  }, [activeTab?.id, activeTab?.state, currentPageUrl, drawerTab, refreshBrowserStorage]);

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

  const copyStorageItems = (items: StorageItem[], label: string) => {
    if (!items.length) return;
    const text = items.map((item) => `${item.key}:\n${item.value}`).join("\n\n");
    void copyText(text, `${label} ${items.length}개를 클립보드에 복사했습니다.`);
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
    if (!selectedEvent) return;
    void copyText(
      apiEventClipboardText(selectedEvent, targetUrl),
      isSessionError(selectedEvent)
        ? "API 오류 내용을 클립보드에 복사했습니다."
        : "API 요청·응답 스펙을 클립보드에 복사했습니다.",
    );
  };

  const startCapture = async () => {
    if (!window.electronAPI?.captureFormAutomationPage) {
      showToast("화면 캡처는 Electron 앱에서 사용할 수 있습니다.");
      return;
    }
    if (captureBusy) return;
    setCaptureBusy(true);
    try { setCapture(await window.electronAPI.captureFormAutomationPage()); }
    catch (error) { showToast(`화면 캡처 실패: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setCaptureBusy(false); }
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
  const selectedOverrideSchema = overrideResponseSchema(openApi, selectedOverride);
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
  const availableCases = [...autoCases, ...scopedCases];
  const selectedCase = availableCases.find((item) => item.id === selectedCaseId);
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
  }, [selectedCase?.id, JSON.stringify(selectedCase?.fields)]);

  const saveCase = () => {
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
    };
    setSavedCases((items) => items.some((item) => item.id === id)
      ? items.map((item) => item.id === id ? next : item)
      : [next, ...items]);
    setSelectedCaseId(id);
    showToast(selectedCase.userSaved ? "수정한 자동 입력 값을 저장했습니다." : "새 자동 입력 케이스를 저장했습니다.");
  };

  const createCaseFromCurrentPage = async () => {
    const fields = await discoverFields(true);
    showToast(
      fields.length
        ? "현재 화면의 필드를 감지했습니다. 제목과 입력값을 수정한 뒤 저장해 주세요."
        : "현재 화면에서 자동 입력할 필드를 찾지 못했습니다.",
    );
  };

  const deleteCase = () => {
    if (!selectedCase?.userSaved) return;
    setSavedCases((items) => items.filter((item) => item.id !== selectedCase.id));
    setSelectedCaseId(autoCases[0]?.id ?? "");
    showToast("저장한 케이스를 삭제했습니다.");
  };

  const autofill = async (caseOverride?: AutofillCase) => {
    const webview = activeWebview();
    if (!webview?.executeJavaScript) {
      showToast("폼·검색 자동 입력은 Electron 앱에서 사용할 수 있습니다.");
      return;
    }
    let item = caseOverride ?? selectedCase;
    if (!item || item.generated) {
      const latestFields = await discoverFields(false);
      const latestCases = detectedCases(latestFields);
      item = latestCases.find((candidate) => candidate.id === item?.id)
        ?? latestCases.find((candidate) => candidate.kind === item?.kind)
        ?? latestCases[0];
    }
    if (!item) {
      showToast("입력할 폼 또는 검색 필드를 찾지 못했습니다.");
      return;
    }
    setSelectedCaseId(item.id);
    try {
      const result = await webview.executeJavaScript(fillFieldsScript(item.fields)) as FillResult;
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
    let item = selectedCase;
    if (!item || !Object.keys(item.fields).length) {
      const latestFields = await discoverFields(false);
      item = detectedCases(latestFields)[0];
    }
    if (!item) {
      showToast("초기화할 폼 또는 검색 필드를 찾지 못했습니다.");
      return;
    }
    try {
      const result = await webview.executeJavaScript(
        clearFieldsScript(Object.keys(item.fields)),
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
    const resize = (moveEvent: MouseEvent) => {
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

  const startNetworkListResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = networkListHeight;
    const inspector = event.currentTarget.closest(".fa-inspector");
    const maximum = Math.max(280, (inspector?.clientHeight || 760) - 330);
    const resize = (moveEvent: globalThis.MouseEvent) => {
      setNetworkListHeight(Math.round(Math.min(maximum, Math.max(120, startHeight + moveEvent.clientY - startY))));
    };
    const stop = () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stop);
      document.body.classList.remove("resizing-form-timeline");
    };
    document.body.classList.add("resizing-form-timeline");
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stop);
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
      <header className="form-automation-header">
        <div>
          <div className="eyebrow">LIVE QA SESSION</div>
          <h1>사이트를 보면서 폼을 자동으로 완성하세요</h1>
          <p>실제 화면의 입력 필드를 감지하고 정상값·오류값 케이스를 즉시 적용합니다.</p>
        </div>
        <div className="fa-header-actions">
          <button className="button fa-header-action secondary" disabled={captureBusy} onClick={() => void startCapture()}>
            <MaterialIcon name="photo_camera" /> {captureBusy ? "캡처 중…" : "화면 캡처"}
          </button>
          <button className="button fa-header-action secondary" onClick={() => setOpenApiDialog(true)}>
            <MaterialIcon name="data_object" /> {openApi ? "Swagger 연결됨" : "Swagger 연결"}
          </button>
          <button className="button button-primary fa-header-action" onClick={() => void autofill()}>
            <MaterialIcon name="auto_fix_high" /> 선택 케이스 자동 입력
          </button>
        </div>
      </header>

      <div
        className={`form-automation-workbench${focusMode ? " browser-focus" : ""}`}
        style={focusMode ? undefined : { gridTemplateColumns: `minmax(0, 1fr) 5px ${inspectorWidth}px` }}
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
                    <span className="fa-tab-grip"><MaterialIcon name="drag_indicator" /></span>
                    {editingTabId === tab.id ? (
                      <input
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
                      <button
                        className="fa-session-main"
                        role="tab"
                        aria-selected={tab.id === activeTab.id}
                        onClick={() => switchBrowserTab(tab.id)}
                        onDoubleClick={() => { setEditingTabId(tab.id); setEditingTabName(tab.name); }}
                      >
                        <span className="fa-session-number">{index + 1}</span>
                        <span><strong>{tab.name}</strong><small>{urlHost(tab.currentPageUrl || tab.url)}</small></span>
                      </button>
                    )}
                    {editingTabId !== tab.id && (
                      <button
                        className="fa-tab-icon"
                        aria-label={`${tab.name} 이름 수정`}
                        onClick={() => { setEditingTabId(tab.id); setEditingTabName(tab.name); }}
                      ><MaterialIcon name="edit" /></button>
                    )}
                    {browserTabs.length > 1 && editingTabId !== tab.id && (
                      <button className="fa-tab-icon" aria-label={`${tab.name} 닫기`} onClick={() => closeBrowserTab(tab.id)}>
                        <MaterialIcon name="close" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button className="fa-session-add" onClick={addBrowserTab} disabled={browserTabs.length >= MAX_FORM_SESSIONS}>
              <MaterialIcon name="add" /> 새 세션
            </button>
          </div>

          <div className="fa-browser-toolbar">
            <div className="fa-browser-actions">
              <button disabled={!activeTab.history.back} onClick={() => activeWebview()?.goBack()} aria-label="뒤로가기"><MaterialIcon name="arrow_back" /></button>
              <button disabled={!activeTab.history.forward} onClick={() => activeWebview()?.goForward()} aria-label="앞으로가기"><MaterialIcon name="arrow_forward" /></button>
              <button onClick={() => activeWebview()?.reload()} aria-label="새로고침"><MaterialIcon name={activeTab.state === "loading" ? "progress_activity" : "refresh"} /></button>
            </div>
            <form className="fa-address-bar" onSubmit={(event) => { event.preventDefault(); navigate(); }}>
              <MaterialIcon name="lock" />
              <input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} aria-label="대상 사이트 주소" />
              <button type="submit">이동</button>
            </form>
            <span className={`fa-status ${activeTab.state}`}>
              {activeTab.state === "ready" ? "연결됨" : activeTab.state === "error" ? "연결 실패" : "로딩 중"}
            </span>
            <div className="fa-zoom" aria-label="브라우저 화면 배율">
              <button aria-label="화면 축소" disabled={zoomPercent <= 50} onClick={() => setZoomPercent((value) => Math.max(50, value - 5))}><MaterialIcon name="remove" /></button>
              <button className="fa-zoom-value" title="100%로 초기화" onClick={() => setZoomPercent(100)}>{zoomPercent}%</button>
              <button aria-label="화면 확대" disabled={zoomPercent >= 125} onClick={() => setZoomPercent((value) => Math.min(125, value + 5))}><MaterialIcon name="add" /></button>
            </div>
            <button className={`fa-focus${focusMode ? " active" : ""}`} onClick={() => setFocusMode((value) => !value)}>
              <MaterialIcon name={focusMode ? "close_fullscreen" : "open_in_full"} />
              {focusMode ? "패널 열기" : "크게 보기"}
            </button>
          </div>

          <div className="fa-browser-surface">
            {browserTabs.map((tab) => (
              <webview
                className={`fa-webview${tab.id === activeTab.id ? " active" : ""}`}
                key={tab.id}
                ref={webviewRefFor(tab.id)}
                src={tab.url}
                partition={browserSessionPartition(tab.id)}
                allowpopups={true}
              />
            ))}
          </div>
        </section>

        <div className="fa-inspector-resizer" onMouseDown={startInspectorResize} title="드래그해서 패널 너비 조절"><span /></div>

        <aside className="fa-inspector">
          <div className="fa-inspector-tabs">
            <button className={drawerTab === "network" ? `active${activeErrorCount ? " has-error" : ""}` : ""} onClick={() => setDrawerTab("network")}><MaterialIcon name="lan" /> 네트워크 <b>{activeErrorCount || activeNetworkEvents.length}</b></button>
            <button className={drawerTab === "cases" ? "active" : ""} onClick={() => { setDrawerTab("cases"); if (!discoveredFields.length) void discoverFields(true); }}><MaterialIcon name="auto_awesome" /> 자동 입력 <b>{availableCases.length}</b></button>
            <button className={drawerTab === "storage" ? "active" : ""} onClick={() => setDrawerTab("storage")}><MaterialIcon name="database" /> 저장소 <b>{storageTotal}</b></button>
            <button className={drawerTab === "override" ? "active" : ""} onClick={() => setDrawerTab("override")}><MaterialIcon name="tune" /> 오버라이드 <b>{overrides.filter((item) => item.enabled).length}</b></button>
          </div>
          {drawerTab === "network" ? (
            <NetworkPanel
              events={activeNetworkEvents}
              selectedEvent={selectedEvent}
              filter={networkFilter}
              activeSessionName={activeTab.name}
              onSelect={setSelectedEvent}
              onFilter={setNetworkFilter}
              onCopy={copyApiEvent}
              onCreateOverride={createOverrideFromEvent}
              onClear={() => void clearSessionLog()}
              onDownload={() => void downloadSessionLog()}
              listHeight={networkListHeight}
              onResizeList={startNetworkListResize}
              onResetListHeight={() => setNetworkListHeight(305)}
            />
          ) : drawerTab === "storage" ? (
            <StoragePanel
              activeSession={activeTab}
              currentPageUrl={currentPageUrl}
              snapshot={storageSnapshot}
              busy={storageBusy}
              bucket={storageBucket}
              query={storageQuery}
              onBucket={setStorageBucket}
              onQuery={setStorageQuery}
              onRefresh={() => void refreshBrowserStorage()}
              onCopy={copyStorageItems}
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
              onCreate={createOverrideFromEvent}
              onSave={() => void saveOverride()}
              onReset={() => void resetOverride()}
              onDelete={deleteOverride}
            />
          ) : (
            <>
          <div className="fa-inspector-heading">
            <div><strong>폼·검색 자동 입력 케이스</strong><span>일반 입력, 라벨, 날짜 선택과 유효성 조건 감지</span></div>
            <button onClick={() => void discoverFields(true)}><MaterialIcon name="refresh" /> 다시 감지</button>
          </div>
          <div className="fa-discovery-notice"><MaterialIcon name="auto_awesome" /><span>{discoveryStatus}</span></div>
          <div className="fa-case-scope">
            <MaterialIcon name="language" />
            <span><small>현재 화면</small><strong title={currentPageScope}>{pageScopeLabel(currentPageScope)}</strong></span>
            <em>{scopedCases.length}개 저장</em>
          </div>
          <div className="fa-case-filters" role="group" aria-label="케이스 유형 필터">
            <button className={caseFilter === "all" ? "active" : ""} onClick={() => setCaseFilter("all")}>전체 <b>{availableCases.length}</b></button>
            <button className={caseFilter === "success" ? "active success" : "success"} onClick={() => setCaseFilter("success")}>성공 <b>{counts.success}</b></button>
            <button className={caseFilter === "failure" ? "active failure" : "failure"} onClick={() => setCaseFilter("failure")}>실패 <b>{counts.failure}</b></button>
          </div>
          <div className="fa-case-list">
            {visibleCases.length ? visibleCases.map((item) => (
              <button
                key={item.id}
                className={`fa-case-card ${item.kind}${item.generated ? " detected" : ""}${selectedCaseId === item.id ? " selected" : ""}`}
                onClick={() => void autofill(item)}
              >
                <span className="fa-case-icon"><MaterialIcon name={item.kind === "success" ? "check_circle" : "error"} /></span>
                <span><strong>{item.name}</strong><small>{item.screen} · {caseValueCount(item)}개 값</small></span>
                <span className="fa-case-badges"><b>{item.kind === "success" ? "성공" : "실패"}</b><em>{item.generated ? "자동" : "저장"}</em></span>
              </button>
            )) : (
              <div className="fa-case-empty"><MaterialIcon name="auto_awesome" /><strong>현재 화면에 자동 입력 케이스가 없습니다</strong><span>입력 화면을 연 뒤 다시 감지해 주세요.</span></div>
            )}
          </div>

          {selectedCase && (
            <div className="fa-values">
              <div className="fa-values-title"><strong>케이스 입력값 편집</strong><span>{selectedCase.fieldMeta.length}개</span></div>
              <div className="fa-case-meta">
                <label><span>케이스 제목</span><input maxLength={80} value={caseDraftName} onChange={(event) => setCaseDraftName(event.target.value)} /></label>
                <label><span>케이스 유형</span><select value={caseDraftKind} onChange={(event) => setCaseDraftKind(event.target.value as "success" | "failure")}><option value="success">성공 · 정상값</option><option value="failure">실패 · 오류값</option></select></label>
              </div>
              {selectedCase.fieldMeta.map((field) => (
                <div className="fa-value-row" key={field.name}>
                  <span><strong>{field.label || field.name}{field.required ? " *" : ""}</strong><code>{field.name}</code></span>
                  <CaseValueInput
                    field={field}
                    value={caseDraftFields[field.name]}
                    onChange={(value) => setCaseDraftFields((current) => ({ ...current, [field.name]: value }))}
                  />
                </div>
              ))}
              <div className="fa-values-actions">
                {selectedCase.userSaved && <button className="danger" onClick={deleteCase}><MaterialIcon name="delete" /> 삭제</button>}
                <button onClick={() => { setCaseDraftName(selectedCase.userSaved ? selectedCase.name : `${selectedCase.name} · 저장본`); setCaseDraftKind(selectedCase.kind); setCaseDraftFields(cloneFields(selectedCase.fields)); }}><MaterialIcon name="restore" /> 원본 복구</button>
                <button className="save" onClick={saveCase}><MaterialIcon name="save" /> {selectedCase.userSaved ? "수정값 저장" : "새 케이스로 저장"}</button>
              </div>
            </div>
          )}

          <div className="fa-inspector-footer">
            <button className="primary" onClick={() => void autofill()}><MaterialIcon name="auto_fix_high" /> 선택 데이터 다시 입력</button>
            <button onClick={() => void clearAutofill()}><MaterialIcon name="restart_alt" /> 현재 입력값 초기화</button>
            <button onClick={() => void createCaseFromCurrentPage()}><MaterialIcon name="add" /> 현재 화면 케이스 만들기</button>
          </div>
            </>
          )}
        </aside>
      </div>
      {toast && <div className="toast"><span className="toast-dot" />{toast}</div>}
      {openApiDialog && <OpenApiDialog document={openApi} onApply={setOpenApi} onClose={() => setOpenApiDialog(false)} />}
      {capture && <ScreenshotEditor capture={capture} onCancel={() => setCapture(null)} onCopy={copyCapture} />}
    </div>
  );
};
