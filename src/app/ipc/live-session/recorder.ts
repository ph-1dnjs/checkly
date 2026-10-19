import { readFile } from "node:fs/promises";
import { electronOutPath } from "../../paths";

let source: Promise<string> | undefined;
export const recorderSource = async (transport: "electron" | "playwright", key: string): Promise<string> => {
  source ??= readFile(electronOutPath("live-session-recorder.js"), "utf8");
  return `${await source}\n;(${installRecorder.toString()})(${JSON.stringify(transport)}, ${JSON.stringify(key)});`;
};

// This function is serialized into the tested page; keep it self-contained.
function installRecorder(transport: string, key: string) {
  if (window.top !== window) return;
  const page = window as unknown as Record<string, any>;
  if (page.__CHECKLY_REPLAY__?.key === key) return;
  page.__CHECKLY_REPLAY__?.stop();
  const documentId = crypto.randomUUID?.() ?? `document-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let pending: unknown[] = [];
  let stopped = false;
  const cleanUrl = (value: string) => {
    try {
      const url = new URL(value, location.href);
      url.search = ""; url.hash = ""; url.username = ""; url.password = "";
      return url.href;
    } catch { return ""; }
  };
  // Sanitize before crossing the browser boundary, including DOM snapshot attributes.
  const sanitize = (value: any): any => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(sanitize);
    const result: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value)) {
      if (name === "attributes" && child && typeof child === "object") {
        const attributes: Record<string, unknown> = {};
        for (const [attribute, raw] of Object.entries(child)) {
          if (/^on|^data-|token|secret|password|nonce/i.test(attribute)) continue;
          if (["href", "src", "action", "poster", "xlink:href"].includes(attribute) && typeof raw === "string") {
            attributes[attribute] = /^(data:|blob:)/i.test(raw) ? "" : cleanUrl(raw);
          } else if (attribute === "srcset") attributes[attribute] = "";
          else attributes[attribute] = raw;
        }
        result[name] = attributes;
      } else if (name === "href" && typeof child === "string") result[name] = cleanUrl(child);
      else result[name] = sanitize(child);
    }
    return result;
  };
  const send = (batch: unknown) => transport === "electron"
    ? page.__CHECKLY_SESSION_BRIDGE__?.emit(key, batch)
    : page.__checklyReplayEmit?.(key, batch);
  const flush = () => {
    if (!pending.length) return;
    const events = pending;
    pending = [];
    void send({ documentId, url: cleanUrl(location.href), title: document.title.slice(0, 200), events });
  };
  const record = page.rrwebRecord.record;
  const stopRecording = record({
    maskAllInputs: true,
    maskTextSelector: '[contenteditable], [data-private], .sentry-mask',
    blockSelector: '[data-checkly-block], .sentry-block',
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
    slimDOMOptions: true,
    sampling: { mousemove: 100, scroll: 150, input: "last" },
    emit(event: unknown) {
      pending.push(sanitize(event));
      if (pending.length >= 100) flush();
    },
  });
  if (!stopRecording) throw new Error("화면 기록기를 시작할 수 없습니다.");
  const timer = window.setInterval(flush, 500);
  const snapshots = window.setInterval(() => record.takeFullSnapshot(true), 5000);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopRecording();
    window.clearInterval(timer);
    window.clearInterval(snapshots);
    flush();
    window.removeEventListener("pagehide", stop);
    delete page.__CHECKLY_REPLAY__;
  };
  page.__CHECKLY_REPLAY__ = { key, stop, flush };
  window.addEventListener("pagehide", stop);
  flush();
}
