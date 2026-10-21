import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { NativeInspectorSnapshot, NativeOverride, SimulatorApp, SimulatorDevice, SimulatorFrame, SimulatorInput, SimulatorStatus } from "../../../app/ipc/form-automation/nativeInspectorTypes";
import { PageHeader } from "../../shared/ui/PageLayout";
import { NetworkPanel, OverridePanel } from "./InspectorPanels";
import { ScreenshotEditor, type ScreenshotCapture } from "./ScreenshotEditor";
import { apiEventClipboardText, safeJson, stringify, type NetworkEvent } from "./liveQa";
import { useStoredState } from "./StoredState";

const EMPTY: NativeInspectorSnapshot = { running: false, port: 4319, revision: 0, clients: [], events: [] };

export function NativeInspectorPage({ onBack }: { onBack: () => void }) {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [devices, setDevices] = useState<SimulatorDevice[]>([]);
  const [udid, setUdid] = useState("");
  const [apps, setApps] = useState<SimulatorApp[]>([]);
  const [bundleId, setBundleId] = useState("");
  const [frame, setFrame] = useState<SimulatorFrame | null>(null);
  const [capture, setCapture] = useState<ScreenshotCapture | null>(null);
  const [simulator, setSimulator] = useState<SimulatorStatus>({ udid: null, streaming: false, error: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"network" | "override">("network");
  const [clientId, setClientId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [filter, setFilter] = useState<"all" | "errors">("all");
  const [rules, storeRules] = useStoredState<NativeOverride[]>("checkly-form-native-overrides", []);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [draft, setDraft] = useState<NativeOverride | undefined>();
  const [body, setBody] = useState("{}");
  const [editorMode, setEditorMode] = useState<"fields" | "json">("json");
  const [listHeight, setListHeight] = useState(280);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const lastWheel = useRef(0);
  const mounted = useRef(true);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const api = window.electronAPI;
  const report = (value: unknown) => { if (mounted.current) setError(value instanceof Error ? value.message : String(value)); };

  const refresh = useCallback(async () => {
    if (!api?.nativeInspectorSnapshot) throw new Error("Checkly를 다시 실행해 모바일 연결 기능을 불러와 주세요.");
    const [network, status] = await Promise.all([api.nativeInspectorSnapshot(), api.simulatorStatus()]);
    if (mounted.current) { setSnapshot(network); setSimulator(status); }
  }, [api]);

  const loadDevices = async () => {
    try {
      const values = await api.simulatorDevices();
      if (!mounted.current) return;
      setDevices(values);
      setUdid(current => values.some(item => item.udid === current) ? current : (values.find(item => item.state === "Booted") ?? values[0])?.udid || "");
    } catch (value) { report(value); }
  };

  useEffect(() => {
    mounted.current = true;
    let pending = false;
    const poll = () => {
      if (pending) return;
      pending = true;
      void refresh().catch(report).finally(() => { pending = false; });
    };
    poll();
    void loadDevices();
    const timer = window.setInterval(poll, 1500);
    const unsubscribe = api?.onSimulatorFrame?.(setFrame);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      unsubscribe?.();
      resizeCleanup.current?.();
      void api?.disconnectSimulator?.().catch(() => {});
      void api?.stopNativeInspector?.().catch(() => {});
    };
  }, [refresh]);

  const activeClientId = clientId || bundleId || snapshot.clients[0]?.id || "";
  const client = snapshot.clients.find(item => item.id === activeClientId);
  const connected = Boolean(snapshot.running && client && Date.now() - client.lastSeen < 6000);
  const events = snapshot.events.filter(item => item.browserSessionId === activeClientId);
  const selectedEvent = events.find(item => item.id === selectedEventId) ?? null;
  const appRules = rules.filter(rule => rule.clientId === activeClientId);
  const selectedRule = appRules.find(rule => rule.id === selectedRuleId) ?? appRules[0];

  useEffect(() => {
    setDraft(selectedRule);
    setBody(stringify(selectedRule?.body ?? {}));
  }, [selectedRule]);

  const connect = async () => {
    setBusy(true); setError(""); setFrame(null);
    try {
      await api.startNativeInspector(rules);
      if (!mounted.current) { await api.stopNativeInspector(); return; }
      await api.connectSimulator(udid);
      if (!mounted.current) { await api.disconnectSimulator(); return; }
      const installed = await api.simulatorApps(udid);
      if (!mounted.current) return;
      setApps(installed);
      setBundleId(current => installed.some(app => app.bundleId === current) ? current : installed[0]?.bundleId || "");
      await refresh();
    } catch (value) { report(value); }
    finally { if (mounted.current) setBusy(false); }
  };

  const stop = async () => {
    setBusy(true);
    try { await Promise.all([api.disconnectSimulator(), api.stopNativeInspector()]); setFrame(null); await refresh(); }
    catch (value) { report(value); }
    finally { setBusy(false); }
  };

  const sendInput = (input: SimulatorInput) => { void api.simulatorInput(udid, input).catch(report); };
  const point = (event: PointerEvent<HTMLImageElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
  };

  const commit = async (next: NativeOverride[]) => {
    await api.setNativeInspectorRules(next);
    if (!await storeRules(next)) {
      await api.setNativeInspectorRules(rules);
      throw new Error("규칙 저장에 실패해 이전 설정을 유지했습니다.");
    }
    await refresh();
  };
  const replaceRule = (next: NativeOverride) => commit(rules.map(rule => rule.id === next.id ? next : rule));
  const createRule = () => {
    if (!selectedEvent) { setError("네트워크 요청을 먼저 선택해 주세요."); return; }
    if (selectedEvent.overridden) { setError("규칙을 끄고 원본 응답을 받은 뒤 복제해 주세요."); return; }
    const url = new URL(selectedEvent.url); url.search = ""; url.hash = "";
    const existing = appRules.find(item => item.method === selectedEvent.method && item.match.replace(/\/+$/, "") === url.href.replace(/\/+$/, ""));
    const rule: NativeOverride = { id: existing?.id || crypto.randomUUID(), clientId: activeClientId, name: `${selectedEvent.method} ${url.pathname}`,
      match: url.href, method: selectedEvent.method, status: selectedEvent.status >= 200 ? selectedEvent.status : 200,
      enabled: false, body: selectedEvent.responseBody ?? {}, sourceBody: selectedEvent.responseBody, sourceUrl: selectedEvent.url };
    void commit([...rules.filter(item => item.id !== rule.id), rule]).then(() => { setSelectedRuleId(rule.id); setTab("override"); }).catch(report);
  };

  const copy = (value: string) => { void api.copyFormAutomationText(value).catch(report); };
  const copyCapture = async (dataUrl: string) => {
    try {
      await api.copyFormAutomationImage(dataUrl);
      setCapture(null);
    } catch (value) { report(value); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([stringify(events)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `checkly-mobile-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const latest = selectedRule && events.find(event => {
    try { return event.method === selectedRule.method && new URL(event.url).origin === new URL(selectedRule.match).origin
      && new URL(event.url).pathname.replace(/\/+$/, "") === new URL(selectedRule.match).pathname.replace(/\/+$/, ""); }
    catch { return false; }
  });
  const applied = Boolean(connected && selectedRule?.enabled && latest?.overridden && latest.ruleRevision === snapshot.revision && client?.revision === snapshot.revision);

  return <div className="form-automation-page">
    <PageHeader icon="smartphone" title="모바일 앱" className="form-automation-header">
      <div className="fa-header-actions"><button className="button fa-header-action secondary" disabled={!frame || frame.udid !== udid} onClick={() => frame && setCapture({ dataUrl: frame.dataUrl, size: { width: frame.width, height: frame.height } })}><span className="msi" aria-hidden="true">photo_camera</span> 화면 캡처</button><button className="button fa-header-action secondary" onClick={onBack}>웹뷰로 돌아가기</button></div>
    </PageHeader>
    {error && <div className="fa-native-error" role="alert"><span>{error}</span><button onClick={() => setError("")}>닫기</button></div>}
    <div className="fa-native-workbench">
      <section className="fa-native-device">
        <div className="fa-native-toolbar">
          <select aria-label="iOS 시뮬레이터" value={udid} disabled={busy || Boolean(simulator.udid)} onChange={event => { setUdid(event.target.value); setApps([]); setFrame(null); }}>
            {!devices.length && <option value="">기기 없음</option>}
            {devices.map(device => <option key={device.udid} value={device.udid}>{device.name} · {device.runtime}</option>)}
          </select>
          <button onClick={() => void loadDevices()} disabled={busy}>기기 새로고침</button>
          <button className="primary" disabled={busy || !udid} onClick={() => void connect()}>{busy ? "연결 중…" : "연결"}</button>
          <button disabled={busy || (!simulator.udid && !snapshot.running)} onClick={() => void stop()}>연결 해제</button>
        </div>
        <div className="fa-native-toolbar">
          <select aria-label="시뮬레이터 앱" value={bundleId} onChange={event => { setBundleId(event.target.value); setClientId(""); }}>
            {!apps.length && <option value="">연결 후 앱 선택</option>}
            {apps.map(app => <option key={app.bundleId} value={app.bundleId}>{snapshot.clients.find(item => item.id === app.bundleId)?.name || app.name}</option>)}
          </select>
          <button disabled={!bundleId || busy} onClick={() => { void api.launchSimulatorApp(udid, bundleId).catch(report); }}>앱 열기</button>
          <button disabled={!bundleId || busy} onClick={() => { void api.launchSimulatorApp(udid, bundleId, true).catch(report); }}>앱 재시작</button>
          <button disabled={!simulator.streaming} onClick={() => sendInput({ type: "key", key: "HOME" })}>홈</button>
          <span role="status">{simulator.streaming ? "화면 연결됨" : simulator.udid ? "화면 대기" : "연결 안 됨"}</span>
        </div>
        {simulator.error && <div className="fa-native-error" role="alert">{simulator.error}</div>}
        <div className="fa-native-screen">
          {frame && frame.udid === udid ? <img src={frame.dataUrl} alt="iOS 앱 실시간 화면" draggable={false} tabIndex={0}
            onWheel={event => {
              if (!simulator.streaming || Date.now() - lastWheel.current < 350 || !event.deltaY) return;
              lastWheel.current = Date.now();
              const down = event.deltaY > 0;
              sendInput({ type: "swipe", x: 0.5, y: down ? 0.7 : 0.3, endX: 0.5, endY: down ? 0.3 : 0.7 });
            }}
            onPointerDown={event => { if (!simulator.streaming) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = point(event); }}
            onPointerCancel={() => { drag.current = null; }}
            onPointerUp={event => {
              const start = drag.current; drag.current = null; if (!start || !simulator.streaming) return;
              const end = point(event);
              sendInput(Math.hypot(end.x - start.x, end.y - start.y) < 0.015 ? { type: "tap", ...end } : { type: "swipe", ...start, endX: end.x, endY: end.y });
            }}
            onKeyDown={event => {
              if (!simulator.streaming || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
              if (event.key === "Enter" || event.key === "Backspace") { event.preventDefault(); sendInput({ type: "key", key: event.key === "Enter" ? "ENTER" : "BACKSPACE" }); }
              else if (event.key.length === 1) { event.preventDefault(); sendInput({ type: "text", text: event.key }); }
            }} /> : <div className="fa-native-empty"><span className="msi">smartphone</span><strong>iOS 앱을 Checkly에서 확인하세요</strong><p>기기를 선택하고 연결하면 앱 화면이 여기에 표시됩니다.</p><p>Xcode와 idb가 필요합니다.</p><code>brew install facebook/fb/idb</code></div>}
        </div>
        <form className="fa-native-toolbar" onSubmit={event => { event.preventDefault(); if (text) { sendInput({ type: "text", text }); setText(""); } }}>
          <input aria-label="앱에 입력할 텍스트" placeholder="앱의 입력칸을 선택한 뒤 텍스트 입력" value={text} onChange={event => setText(event.target.value)} maxLength={2000} />
          <button disabled={!simulator.streaming || !text}>입력</button>
        </form>
      </section>
      <aside className="fa-inspector fa-native-inspector">
        <div className="fa-native-toolbar">
          <select aria-label="네트워크 앱" value={activeClientId} onChange={event => { setClientId(event.target.value); setSelectedEventId(""); }}>
            {!client && <option value={activeClientId}>RN 앱 연결 대기</option>}
            {snapshot.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select><span>{connected ? "네트워크 연결됨" : "네트워크 대기"}</span>
        </div>
        <details className="fa-native-help"><summary>React Native 연결 안내</summary><p>연결 모듈을 RN 프로젝트의 index.js 옆에 저장하고, 초기화 코드를 index.js에 추가한 뒤 개발 앱을 새로고침하세요.</p>
          <div className="fa-native-toolbar"><button onClick={() => { void api.saveReactNativeModule().catch(report); }}>연결 모듈 저장</button><button disabled={!bundleId} onClick={() => copy(`if (__DEV__) {\n  require('./checkly').installCheckly({\n    enabled: true,\n    clientId: ${JSON.stringify(bundleId)},\n    name: ${JSON.stringify(apps.find(app => app.bundleId === bundleId)?.name || bundleId)}\n  });\n}`)}>초기화 코드 복사</button></div>
          <p>fetch 요청을 수집합니다. 네이티브 SDK·직접 XHR·WebSocket은 포함하지 않습니다. 규칙을 끄면 원본 요청을 사용합니다.</p><p>연결 주소: 127.0.0.1:{snapshot.port} · 최근 기록은 메모리에만 보관하며 다운로드할 수 있습니다.</p></details>
        <div className="fa-inspector-tabs"><button className={tab === "network" ? "active" : ""} onClick={() => setTab("network")}>네트워크 <b>{events.length}</b></button><button className={tab === "override" ? "active" : ""} onClick={() => setTab("override")}>오버라이드 <b>{appRules.filter(rule => rule.enabled).length}</b></button></div>
        {tab === "network" ? <NetworkPanel events={events} selectedEvent={selectedEvent as NetworkEvent | null}
          activeSessionName={client?.name || "모바일 앱"} description="이 개발 앱의 fetch 요청·응답" filter={filter} onFilter={setFilter}
          emptyDescription="개발 앱에서 API를 호출하는 동작을 실행해 보세요."
          onSelect={event => setSelectedEventId(event.id)} onCopyUrl={copy}
          onCopy={() => { if (selectedEvent) copy(apiEventClipboardText(selectedEvent, selectedEvent.url)); }}
          onCreateOverride={createRule} onClear={() => { void api.clearNativeInspectorEvents().then(refresh).catch(report); }} onDownload={download}
          listHeight={listHeight} onResetListHeight={() => setListHeight(280)} onResizeList={event => {
            const start = event.clientY; const initial = listHeight;
            const move = (next: MouseEvent) => setListHeight(Math.min(600, Math.max(100, initial + next.clientY - start)));
            const stopResize = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stopResize); resizeCleanup.current = null; };
            resizeCleanup.current?.(); resizeCleanup.current = stopResize;
            window.addEventListener("mousemove", move); window.addEventListener("mouseup", stopResize);
          }} /> : <OverridePanel openApi={null} overrides={appRules} selected={draft} bodyText={body} parsedBody={safeJson(body)} editorMode={editorMode}
          description="선택한 React Native 개발 앱에만 적용" note="저장 후 앱에서 같은 요청을 다시 실행하세요. 메서드·호스트·경로가 일치하면 적용하며 쿼리는 무시합니다. 연결 해제 시 원본 요청으로 돌아갑니다."
          status={{ tone: applied ? "success" : "neutral", applied, title: applied ? "오버라이드 응답 확인됨" : connected ? "다음 앱 요청에서 적용" : "앱 연결 대기", detail: connected ? `규칙 동기화 ${client?.revision === snapshot.revision ? "완료" : "대기"}` : "개발 앱과 Checkly를 연결해 주세요." }}
          onSelect={setSelectedRuleId} onEditorMode={setEditorMode} onBodyText={setBody} onCreate={createRule}
          onUpdate={patch => {
            if (!draft) return;
            if (patch.enabled !== undefined) void replaceRule({ ...selectedRule!, enabled: patch.enabled }).catch(report);
            else setDraft({ ...draft, ...patch });
          }}
          onFieldChange={(path, value) => {
            try {
              const parsed = JSON.parse(body); let target = parsed;
              for (const key of path.slice(0, -1)) target = target[key];
              if (path.length) Object.defineProperty(target, path[path.length - 1], { value, enumerable: true, writable: true, configurable: true });
              setBody(stringify(parsed));
            } catch (value) { report(value); }
          }}
          onSave={() => { if (draft) { try { void replaceRule({ ...draft, body: JSON.parse(body), enabled: true }).catch(report); } catch (value) { report(value); } } }}
          onReset={() => { if (selectedRule) void replaceRule({ ...selectedRule, body: selectedRule.sourceBody ?? {}, enabled: false }).catch(report); }}
          onDelete={() => { if (selectedRule) void commit(rules.filter(rule => rule.id !== selectedRule.id)).catch(report); }} />}
      </aside>
    </div>
    {capture && <ScreenshotEditor capture={capture} onCancel={() => setCapture(null)} onCopy={copyCapture} />}
  </div>;
}
