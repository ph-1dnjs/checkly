import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { NativeInspectorSnapshot, NativeOverride, SimulatorApp, SimulatorDevice, SimulatorFrame, SimulatorInput, SimulatorStatus } from "../../../app/ipc/form-automation/nativeInspectorTypes";
import { ScreenTestHeader } from "./ScreenTestHeader";
import { Input } from "../../shared/ui/Input";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
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
  const [installConfirm, setInstallConfirm] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"network" | "override">("network");
  const [clientId, setClientId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [filter, setFilter] = useState<"all" | "errors" | "warnings">("all");
  const [rules, storeRules] = useStoredState<NativeOverride[]>("checkly-form-native-overrides", []);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [overrideEditing, setOverrideEditing] = useState(false);
  const [draft, setDraft] = useState<NativeOverride | undefined>();
  const [body, setBody] = useState("{}");
  const [editorMode, setEditorMode] = useState<"fields" | "json">("json");
  const drag = useRef<{ x: number; y: number } | null>(null);
  const lastWheel = useRef(0);
  const mounted = useRef(true);
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

  const connect = async (install = false) => {
    setBusy(true); setError(""); setFrame(null);
    try {
      if (install) {
        await api.installSimulatorIdb();
        if (!mounted.current) return;
      } else if (!await api.simulatorHasIdb()) {
        if (mounted.current) setInstallConfirm(true);
        return;
      }
      await api.connectSimulator(udid);
      if (!mounted.current) { await api.disconnectSimulator(); return; }
      await api.startNativeInspector(rules);
      if (!mounted.current) { await api.disconnectSimulator(); await api.stopNativeInspector(); return; }
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
    const border = event.currentTarget.clientLeft;
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left - border) / (box.width - border * 2))), y: Math.min(1, Math.max(0, (event.clientY - box.top - border) / (box.height - border * 2))) };
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
    void commit([...rules.filter(item => item.id !== rule.id), rule]).then(() => { setSelectedRuleId(rule.id); setOverrideEditing(true); setTab("override"); }).catch(report);
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
    <ScreenTestHeader title="모바일 앱" icon="smartphone" mode={tab} onMode={mode => { if (mode !== "cases") setTab(mode); }} onBack={onBack}
      errors={events.filter(event => !event.status || event.status >= 400).length} overrides={appRules.filter(rule => rule.enabled).length}>
      <Button variant="ghost" disabled={!frame || frame.udid !== udid} onClick={() => frame && setCapture({ dataUrl: frame.dataUrl, size: { width: frame.width, height: frame.height } })} aria-label="화면 캡처"><span className="msi" aria-hidden="true">photo_camera</span> 캡처</Button>
    </ScreenTestHeader>
    {error && <div className="fa-native-error" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => setError("")}>닫기</Button></div>}
    <div className="fa-native-workbench">
      <section className="fa-native-device">
        <div className="fa-native-toolbar fa-native-device-tools">
          <select aria-label="iOS 시뮬레이터" value={udid} disabled={busy || Boolean(simulator.udid)} onChange={event => { setUdid(event.target.value); setApps([]); setFrame(null); }}>
            {!devices.length && <option value="">기기 없음</option>}
            {devices.map(device => <option key={device.udid} value={device.udid}>{device.name} · {device.runtime}</option>)}
          </select>
          <select aria-label="시뮬레이터 앱" value={bundleId} onChange={event => { setBundleId(event.target.value); setClientId(""); }}>
            {!apps.length && <option value="">연결 후 앱 선택</option>}
            {apps.map(app => <option key={app.bundleId} value={app.bundleId}>{snapshot.clients.find(item => item.id === app.bundleId)?.name || app.name}</option>)}
          </select>
          <Button variant="secondary" disabled={!bundleId || busy} onClick={() => { void api.launchSimulatorApp(udid, bundleId).catch(report); }}><span className="msi" aria-hidden="true">open_in_new</span>앱 열기</Button>
          <Button variant="secondary" aria-label="앱 재시작" disabled={!bundleId || busy} onClick={() => { void api.launchSimulatorApp(udid, bundleId, true).catch(report); }}><span className="msi" aria-hidden="true">restart_alt</span>재시작</Button>
          <Button variant="secondary" disabled={!simulator.streaming} onClick={() => sendInput({ type: "key", key: "HOME" })}><span className="msi" aria-hidden="true">home</span>홈</Button>
          <span role="status">{simulator.streaming ? "화면 연결됨" : simulator.udid ? "화면 대기" : "연결 안 됨"}</span>
          <Button variant="ghost" iconOnly aria-label="기기 새로고침" onClick={() => void loadDevices()} disabled={busy}><span className="msi" aria-hidden="true">refresh</span></Button>
          {simulator.udid || snapshot.running
            ? <Button variant="secondary" disabled={busy} onClick={() => void stop()}>연결 해제</Button>
            : <Button variant="primary" disabled={busy || !udid} onClick={() => void connect()}>{busy ? "연결 중…" : "연결"}</Button>}
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
            }} /> : <div className="fa-native-phone"><div className="fa-native-empty"><span className="msi">smartphone</span><strong>iOS 앱을 Checkly에서 확인하세요</strong><p>기기를 선택하고 연결하면 앱 화면이 여기에 표시됩니다.</p><p>Xcode와 idb가 필요합니다. idb가 없으면 연결할 때 설치를 안내합니다.</p></div></div>}
        </div>
        <form className="fa-native-toolbar fa-native-input" onSubmit={event => { event.preventDefault(); if (simulator.streaming && text) { sendInput({ type: "text", text }); setText(""); } }}>
          <span className="fa-input-hint"><span className="msi" aria-hidden="true">touch_app</span> 입력칸을 먼저 누르세요</span>
          <Input aria-label="앱에 입력할 텍스트" placeholder="앱의 입력칸을 선택한 뒤 텍스트 입력" value={text} onChange={event => setText(event.target.value)} maxLength={2000} />
          <Button type="submit" variant="primary" aria-label="입력" disabled={!simulator.streaming || !text}><span className="msi" aria-hidden="true">send</span>앱에 입력</Button>
        </form>
      </section>
      <aside className="fa-inspector fa-native-inspector">
        <div className={`fa-native-connection${connected ? " connected" : ""}`}>
          <span className="msi" aria-hidden="true">{connected ? "link" : "link_off"}</span><div><strong>{connected ? `${client?.name || "React Native 앱"} 연결됨` : "React Native 앱 연결 대기"}</strong><small>{connected ? "앱의 fetch 요청을 기록하고 있어요" : "연결 모듈을 넣은 개발 앱을 새로고침하면 연결돼요"}</small></div>
          {snapshot.clients.length > 0 && <select aria-label="네트워크 앱" value={activeClientId} onChange={event => { setClientId(event.target.value); setSelectedEventId(""); }}>{!client && <option value={activeClientId}>앱 선택</option>}{snapshot.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        </div>
        {!connected && <details className="fa-native-help" open><summary>연결 안내<span className="msi" aria-hidden="true">expand_more</span></summary>
          <ol className="fa-native-steps">
            <li><b>1</b><div><strong>연결 모듈 저장</strong><p>RN 프로젝트의 index.js 옆에 저장하세요.</p><Button variant="secondary" onClick={() => { void api.saveReactNativeModule().catch(report); }}><span className="msi" aria-hidden="true">download</span> 연결 모듈 저장</Button></div></li>
            <li><b>2</b><div><strong>초기화 코드 추가</strong><p>복사한 코드를 index.js에 붙여 넣으세요.</p><Button variant="secondary" disabled={!bundleId} onClick={() => copy(`if (__DEV__) {\n  require('./checkly').installCheckly({\n    enabled: true,\n    clientId: ${JSON.stringify(bundleId)},\n    name: ${JSON.stringify(apps.find(app => app.bundleId === bundleId)?.name || bundleId)}\n  });\n}`)}><span className="msi" aria-hidden="true">content_copy</span> 초기화 코드 복사</Button></div></li>
            <li><b>3</b><div><strong>개발 앱 새로고침</strong><p>연결되면 앱의 요청이 여기에 쌓여요.</p></div></li>
          </ol>
          <div className="fa-native-help-note"><p>fetch 요청만 기록해요. 네이티브 SDK·직접 XHR·WebSocket은 포함하지 않아요.</p><p>연결 주소 <code>127.0.0.1:{snapshot.port}</code> · 최근 기록은 메모리에만 보관하고 내려받을 수 있어요.</p></div>
        </details>}

        {tab === "network" ? <NetworkPanel events={events} selectedEvent={selectedEvent as NetworkEvent | null}
          activeSessionName={client?.name || "모바일 앱"} heading="앱 요청" description="이 개발 앱의 fetch 요청·응답" filter={filter} onFilter={setFilter}
          emptyDescription="개발 앱에서 API를 호출하는 동작을 실행해 보세요."
          onBack={() => setSelectedEventId("")} onSelect={event => setSelectedEventId(event.id)} onCopyUrl={copy}
          onCopy={() => { if (selectedEvent) copy(apiEventClipboardText(selectedEvent, selectedEvent.url)); }}
          onCreateOverride={createRule} onClear={() => { void api.clearNativeInspectorEvents().then(refresh).catch(report); }} onDownload={download}
 /> : <OverridePanel openApi={null} overrides={appRules} selected={draft} bodyText={body} parsedBody={safeJson(body)} editorMode={editorMode}
          note="저장 후 앱에서 같은 요청을 다시 실행하세요. 메서드·호스트·경로가 일치하면 적용하며 쿼리는 무시합니다. 연결 해제 시 원본 요청으로 돌아갑니다."
          status={{ tone: applied ? "success" : "neutral", applied, title: applied ? "오버라이드 응답 확인됨" : connected ? "다음 앱 요청에서 적용" : "앱 연결 대기", detail: connected ? `규칙 동기화 ${client?.revision === snapshot.revision ? "완료" : "대기"}` : "개발 앱과 Checkly를 연결해 주세요." }}
          editing={overrideEditing} onEditing={setOverrideEditing}
          onToggleRule={(id, enabled) => { const rule = rules.find(item => item.id === id); if (rule) void replaceRule({ ...rule, enabled }).catch(report); }}
          onCreateBlank={() => {
            if (!activeClientId) { setError("먼저 개발 앱을 선택해 주세요."); return; }
            const rule: NativeOverride = { id: crypto.randomUUID(), clientId: activeClientId, name: "새 응답", match: "http://localhost/api/example", method: "GET", status: 200, enabled: false, body: { status: "success", message: "", data: {} } };
            void commit([...rules, rule]).then(() => { setSelectedRuleId(rule.id); setOverrideEditing(true); }).catch(report);
          }}
          onSelect={setSelectedRuleId} onEditorMode={setEditorMode} onBodyText={setBody} onChooseResponse={() => { setSelectedEventId(""); setTab("network"); }}
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
    {installConfirm && <Modal label="idb 설치" backdropClassName="modal-backdrop" className="manual-modal" onClose={() => setInstallConfirm(false)}>
      <h2>idb 설치</h2>
      <p>모바일 앱 연결에 필요한 idb를 설치할까요?</p>
      <p>Homebrew로 facebook/fb 저장소를 추가하고 idb, idb-cli, idb-companion을 신뢰한 뒤 설치합니다. 인터넷 연결과 설치 시간이 필요합니다.</p>
      <div className="modal-actions"><Button variant="secondary" onClick={() => setInstallConfirm(false)}>취소</Button><Button variant="primary" onClick={() => { setInstallConfirm(false); void connect(true); }}>설치</Button></div>
    </Modal>}
  </div>;
}
