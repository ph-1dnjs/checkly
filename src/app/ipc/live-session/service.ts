import { app, type WebContents } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { LocalSessionStore, safePageUrl } from "./storage";
import { recorderSource } from "./recorder";
import { ReplayBuffer, BEFORE_ERROR_MS, AFTER_ERROR_MS } from "./buffer";
import { failureTrigger } from "./failure";
import { getCurrentSession, getSupabase, onSessionChanged } from "../auth/client";
import { browserLog, sameTeam } from "./telemetry";
import { recordedBody } from "./payload";
import { TeamSessionStore } from "./team-store";
import { RecordingLibrary } from "./library";
import type { BrowserLog, LiveSession, RecordingBatch, RecordingScope } from "./types";

type Clip = { logs: BrowserLog[]; logsWarning?: string; session?: LiveSession; trigger: NonNullable<LiveSession["trigger"]>; endAt: number; timer?: ReturnType<typeof setTimeout> };
type ActiveRecording = {
  id: string;
  owner: WebContents;
  title: string;
  url: string;
  source: LiveSession["source"];
  targets: Set<WebContents>;
  buffer: ReplayBuffer;
  logs: BrowserLog[];
  queue: Promise<void>;
  clip?: Clip;
  stopBrowser?: () => Promise<void>;
  flushBrowser?: () => Promise<void>;
  stopping?: Promise<void>;
  finalizing?: boolean;
  acceptEventsAfter?: number;
  pendingSignals: Set<Promise<void>>;
};
const active = new Map<string, ActiveRecording>();
const clips = new Map<string, LiveSession>();
const guests = new Map<number, { contents: WebContents; owner: WebContents }>();
const targetSessions = new Map<number, string>();
let localStore: LocalSessionStore | undefined;
const store = () => localStore ??= new LocalSessionStore(path.join(app.getPath("userData"), "live-sessions"));
const teamStore = new TeamSessionStore(getSupabase, getCurrentSession);
let recordingLibrary: RecordingLibrary | undefined;
const library = () => recordingLibrary ??= new RecordingLibrary(store(), teamStore, getCurrentSession, () => [...clips.values()]);
let identityGeneration = 0;

export const initializeTeamRecording = () => {
  let identity = getCurrentSession();
  onSessionChanged(session => {
    if (sameTeam(identity, session) || (!identity && !session)) return;
    identity = session;
    identityGeneration++;
    recordingLibrary?.identityChanged();
    for (const item of active.values()) {
      if (item.clip) finishClip(item, item.clip);
      item.buffer = new ReplayBuffer();
      item.logs = [];
      item.acceptEventsAfter = Date.now();
      changed(item.owner);
    }
  });
};
const changed = (owner: WebContents) => { if (!owner.isDestroyed()) owner.send("live-session:changed"); };
const stopScript = "window.__CHECKLY_REPLAY__?.stop(); void 0";
const flushScript = "window.__CHECKLY_REPLAY__?.flush(); void 0";
export const hasActiveRecordings = () => active.size > 0;
const flushWithTimeout = async (operation: Promise<unknown>): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("브라우저가 응답하지 않습니다.")), 3000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
};

const createTracking = (owner: WebContents, title: string, url: string, source: LiveSession["source"]): ActiveRecording => {
  const item: ActiveRecording = {
    id: randomUUID(), owner, title, url: safePageUrl(url), source,
    targets: new Set(), buffer: new ReplayBuffer(), logs: [], queue: Promise.resolve(), pendingSignals: new Set(),
  };
  active.set(item.id, item);
  return item;
};

export const snapshot = (scope: RecordingScope = "local") => library().list(scope);
export const uploadRecordings = (ids: string[]) => library().upload(ids);

const enqueue = (item: ActiveRecording, operation: () => Promise<void>) => {
  item.queue = item.queue.then(operation).catch(async error => {
    const session = item.clip?.session;
    if (session) {
      session.status = "error";
      session.error = `오류 전후 기록 저장 실패: ${error instanceof Error ? error.message : String(error)}`;
      await store().save(session).catch(() => undefined);
      clips.delete(session.id);
    }
    console.error("오류 전후 기록 저장 실패", error);
    changed(item.owner);
  });
};

const appendBatches = async (session: LiveSession, batches: RecordingBatch[]) => {
  for (const batch of batches) {
    for (let index = 0; index < batch.events.length; index += 100) {
      await store().append(session, { ...batch, events: batch.events.slice(index, index + 100) });
    }
  }
};

const finishClip = (item: ActiveRecording, clip: Clip) => {
  if (clip.timer) clearTimeout(clip.timer);
  if (item.clip === clip) item.clip = undefined;
  enqueue(item, async () => {
    const session = clip.session;
    if (!session) return;
    session.endedAt = Math.min(Date.now(), clip.endAt);
    session.captureEndAt = session.endedAt;
    if (session.status !== "error") session.status = "saved";
    // Include an end marker so an idle page still replays the post-error interval.
    const recording = await store().read(session.id);
    for (const document of recording.documents) {
      await store().append(session, { documentId: document.id, title: document.title, url: document.url, events: [
        { type: 5, timestamp: session.endedAt, data: { tag: "clip-end", payload: {} } },
      ] });
    }
    try {
      await store().saveLogs(session.id, clip.logs, clip.logsWarning);
      await store().save(session);
    }
    finally { clips.delete(session.id); changed(item.owner); }
  });
};

const captureError = (id: string, trigger: NonNullable<LiveSession["trigger"]>) => {
  const item = active.get(id);
  if (!item || item.clip) return; // Coalesce errors in the same five-second aftermath.
  const before = item.buffer.snapshot(trigger.at);
  const auth = getCurrentSession();
  const clip: Clip = { trigger, endAt: trigger.at + AFTER_ERROR_MS,
    logs: item.logs.filter(log => Date.parse(log.occurred_at) >= trigger.at - BEFORE_ERROR_MS && Date.parse(log.occurred_at) <= trigger.at + AFTER_ERROR_MS) };
  item.clip = clip;
  enqueue(item, async () => {
    const session = await store().create(item.title || "브라우저 오류", trigger.url || item.url, item.source);
    clip.session = session;
    session.browserSessionId = item.id;
    if (auth) session.team = { projectId: auth.projectId, userId: auth.userId };
    session.syncStatus = "local";
    session.trigger = trigger;
    session.startedAt = trigger.at;
    session.captureStartAt = trigger.at - BEFORE_ERROR_MS;
    session.captureEndAt = clip.endAt;
    await store().save(session);
    await store().saveLogs(session.id, clip.logs);
    clips.set(session.id, session);
    await appendBatches(session, before);
    changed(item.owner);
  });
  clip.timer = setTimeout(() => {
    void Promise.all([...item.targets].map(contents => contents.isDestroyed() ? Promise.resolve()
      : flushWithTimeout(contents.executeJavaScript(flushScript)).catch(() => undefined)))
      .then(() => item.flushBrowser?.()).then(async () => {
        await new Promise(resolve => setImmediate(resolve));
        if (item.clip === clip) finishClip(item, clip);
      }).catch(error => console.error("오류 후 기록 마감 실패", error));
  }, Math.max(0, clip.endAt - Date.now()));
};

export const receiveBatch = (id: string, payload: unknown): void => {
  const item = active.get(id);
  if (!item) return;
  const batch = payload as RecordingBatch;
  if (!batch || typeof batch.documentId !== "string" || batch.documentId.length > 100
    || typeof batch.url !== "string" || typeof batch.title !== "string"
    || !Array.isArray(batch.events) || !batch.events.length || batch.events.length > 100
    || batch.events.some(event => !event || !Number.isFinite(event.timestamp) || !Number.isInteger(event.type))) return;
  try { if (Buffer.byteLength(JSON.stringify(batch)) > 8 * 1024 * 1024) return; }
  catch { return; }
  if (item.acceptEventsAfter) batch.events = batch.events.filter(event => event.timestamp >= item.acceptEventsAfter!);
  if (!batch.events.length) return;
  item.title = batch.title || item.title;
  item.buffer.add(batch);
  const clip = item.clip;
  if (clip) {
    const events = batch.events.filter(event => event.timestamp <= clip.endAt);
    if (events.length) enqueue(item, async () => {
      if (clip.session && clip.session.status !== "error") await appendBatches(clip.session, [{ ...batch, events }]);
    });
  }
};

const inject = async (contents: WebContents, item: ActiveRecording): Promise<void> => {
  const source = await recorderSource("electron", item.id);
  if (!contents.isDestroyed() && !item.finalizing) await contents.executeJavaScript(source);
};
const addTarget = (item: ActiveRecording, contents: WebContents) => {
  item.targets.add(contents);
  targetSessions.set(contents.id, item.id);
};

export const attachReplayGuest = (contents: WebContents, owner: WebContents, parent?: WebContents): void => {
  guests.set(contents.id, { contents, owner });
  const inherited = parent && targetSessions.get(parent.id);
  if (inherited && active.has(inherited)) addTarget(active.get(inherited)!, contents);
  contents.on("did-navigate", (_event, url, status) => receiveGuestError(contents, {
    type: "navigation", url, pageUrl: url, ...(status >= 0 ? { status } : {}),
  }));
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) receiveGuestError(contents, { type: "navigation", url, pageUrl: url });
  });
  contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) receiveGuestError(contents, { type: "resource-error", url, status: 0 });
  });
  contents.on("dom-ready", () => {
    if (!/^https?:\/\//i.test(contents.getURL())) return;
    let item = active.get(targetSessions.get(contents.id) ?? "");
    if (!item) {
      item = createTracking(owner, contents.getTitle(), contents.getURL(), "browser");
      addTarget(item, contents);
    }
    const tracking = item;
    void inject(contents, tracking).catch(error => console.error("브라우저 오류 버퍼 연결 실패", error));
  });
  contents.once("destroyed", () => {
    const id = targetSessions.get(contents.id);
    guests.delete(contents.id); targetSessions.delete(contents.id);
    const item = id && active.get(id);
    if (!item) return;
    item.targets.delete(contents);
    if (!item.targets.size) void stopRecording(item.id, owner).catch(error => console.error("오류 기록 종료 실패", error));
  });
};

export const receiveGuestBatch = (sender: WebContents, key: string, batch: unknown) => {
  if (targetSessions.get(sender.id) === key) receiveBatch(key, batch);
};
export const receiveGuestError = (sender: WebContents, payload: unknown): void => {
  const guest = guests.get(sender.id);
  if (!guest || !browserLog(payload, "", "browser")) return;
  let id = targetSessions.get(sender.id);
  if (!id && /^https?:\/\//i.test(sender.getURL())) {
    const item = createTracking(guest.owner, sender.getTitle(), sender.getURL(), "browser");
    addTarget(item, sender); id = item.id;
  }
  if (!id) return;
  const item = active.get(id);
  if (item) receiveSignal(item, payload, () => flushWithTimeout(sender.executeJavaScript(flushScript)));
};

const receiveSignal = (item: ActiveRecording, payload: unknown, flush: () => Promise<void>) => {
  if (item.finalizing) return;
  const log = browserLog(payload, item.id, item.source);
  if (!log) return;
  const now = Date.parse(log.occurred_at);
  item.logs = item.logs.filter(entry => Date.parse(entry.occurred_at) >= now - BEFORE_ERROR_MS);
  item.logs.push(log);
  if (item.logs.length > 2000) item.logs.shift();
  if (item.clip && now <= item.clip.endAt) {
    if (item.clip.logs.length < 2000) item.clip.logs.push(log);
    else item.clip.logsWarning = "로그가 많아 일부 항목이 생략되었습니다.";
  }
  const trigger = failureTrigger(payload);
  if (!trigger) return log;
  trigger.at = Date.parse(log.occurred_at); trigger.logId = log.id; trigger.url = log.url;
  const generation = identityGeneration;
  // Flush the sub-second events still pending in the guest before taking the pre-error buffer.
  const pending = flush().catch(() => undefined).then(async () => {
    await new Promise(resolve => setImmediate(resolve));
    if (generation === identityGeneration) captureError(item.id, trigger);
  }).finally(() => item.pendingSignals.delete(pending));
  item.pendingSignals.add(pending);
  return log;
};

export const stopRecording = async (id: string, owner: WebContents, collectAftermath = false): Promise<void> => {
  const item = active.get(id);
  if (!item) return;
  if (item.owner !== owner) throw new Error("이 창의 기록만 종료할 수 있습니다.");
  if (item.stopping) return item.stopping;
  item.stopping = (async () => {
    if (collectAftermath) {
      await Promise.all(item.pendingSignals);
      const remaining = (item.clip?.endAt ?? 0) - Date.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    }
    item.finalizing = true;
    await Promise.all([...item.targets].map(async contents => {
      if (!contents.isDestroyed()) await flushWithTimeout(contents.executeJavaScript(stopScript)).catch(() => undefined);
    }));
    await item.stopBrowser?.();
    await Promise.all(item.pendingSignals);
    await new Promise(resolve => setImmediate(resolve));
    if (item.clip) finishClip(item, item.clip);
    await item.queue;
    for (const contents of item.targets) targetSessions.delete(contents.id);
    active.delete(id); // Discard the ordinary in-memory history, without writing it.
  })();
  return item.stopping;
};
export const readRecording = async (id: string, scope: RecordingScope = "local") => {
  for (const item of active.values()) if (item.clip?.session?.id === id) await item.queue;
  const recording = await library().read(id, scope);
  if (scope === "local" && clips.has(id)) {
    recording.session = { ...clips.get(id)! };
    for (const item of active.values()) if (item.clip?.session?.id === id) {
      recording.logs = [...item.clip.logs]; recording.logsWarning = item.clip.logsWarning;
    }
  }
  return recording;
};
export const removeRecording = (id: string, scope: RecordingScope = "local") => library().remove(id, scope);
export const stopOwnerRecordings = async (owner?: WebContents) => {
  await Promise.all([...active.values()].filter(item => !owner || item.owner === owner).map(item => stopRecording(item.id, item.owner)));
};

const contexts = new WeakSet<BrowserContext>();
const contextSessions = new WeakMap<BrowserContext, string>();
export const startScenarioRecording = async (context: BrowserContext, owner: WebContents, title: string, url: string): Promise<string> => {
  if (!contexts.has(context)) {
    await context.exposeBinding("__checklyReplayOpen", () => contextSessions.get(context) ?? null);
    await context.exposeBinding("__checklyReplayEmit", (_source, key: string, batch: unknown) => {
      if (contextSessions.get(context) === key) receiveBatch(key, batch);
    });
    const signal = (payload: unknown) => {
      const id = contextSessions.get(context);
      const item = id && active.get(id);
      if (item) return receiveSignal(item, payload, async () => {
        await Promise.all(context.pages().map(page => flushWithTimeout(page.evaluate(flushScript)).catch(() => undefined)));
      });
    };
    context.on("page", page => {
      page.on("pageerror", () => signal({ type: "page-error", url: page.url() }));
      page.on("console", message => { if (message.type() === "error") signal({ type: "console-error", url: page.url() }); });
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) signal({ type: "navigation", url: frame.url(), pageUrl: frame.url() }); });
    });
    context.on("response", response => {
      const request = response.request();
      const api = ["fetch", "xhr"].includes(request.resourceType());
      if (!api && response.status() < 400) return;
      let pageUrl = "";
      try { pageUrl = request.frame().url(); } catch { /* Service worker requests have no frame. */ }
      const payload = {
        type: request.resourceType() === "xhr" ? "xhr" : "fetch", status: response.status(), url: response.url(), method: request.method(),
        pageUrl,
      };
      if (!api || response.status() < 400) { signal(payload); return; }
      const id = contextSessions.get(context);
      const item = id && active.get(id);
      if (!item) return;
      const log = signal({ ...payload, requestBody: request.postData() });
      const generation = identityGeneration;
      const pending = (async () => {
        let responseBody: string | undefined;
        let responseContentType = "";
        try {
          responseContentType = response.headers()["content-type"] ?? "";
          if (/json/i.test(responseContentType) && Number(response.headers()["content-length"] ?? 0) <= 12 * 1024) {
            await flushWithTimeout(response.body().then(body => { if (body.length <= 12 * 1024) responseBody = body.toString("utf8"); }));
          }
        } catch { /* Keep the failed request even when its response body is unavailable. */ }
        if (generation === identityGeneration && active.get(item.id) === item && log?.payload) {
          log.payload.response = recordedBody(responseBody);
          log.payload.responseContentType = responseContentType.slice(0, 120).replace(/[^\w\s/;=.+-]/g, "");
        }
      })().finally(() => item.pendingSignals.delete(pending));
      item.pendingSignals.add(pending);
    });
    context.on("requestfailed", request => {
      let pageUrl = "";
      try { pageUrl = request.frame().url(); } catch { /* Service worker requests have no frame. */ }
      signal({ type: request.resourceType() === "xhr" ? "xhr" : "fetch", status: 0, error: true, url: request.url(), method: request.method(),
        pageUrl, requestBody: request.postData() });
    });
    const template = await recorderSource("playwright", "__CHECKLY_DYNAMIC_KEY__");
    const script = template.replace('"__CHECKLY_DYNAMIC_KEY__"', "key");
    await context.addInitScript({ content: `window.__checklyReplayOpen().then(key => { if (key) { ${script} } });` });
    contexts.add(context);
  }
  const item = createTracking(owner, title, url, "scenario");
  contextSessions.set(context, item.id);
  item.flushBrowser = async () => {
    await Promise.all(context.pages().map(page => flushWithTimeout(page.evaluate(flushScript)).catch(() => undefined)));
  };
  item.stopBrowser = async () => {
    await Promise.all(context.pages().map(page => flushWithTimeout(page.evaluate(stopScript)).catch(() => undefined)));
    contextSessions.delete(context);
  };
  return item.id;
};
