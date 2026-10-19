import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { NativeInspectorSnapshot, NativeNetworkEvent, NativeOverride } from "./nativeInspectorTypes";

const MAX_BODY = 256 * 1024;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export class NativeInspector {
  private server?: Server;
  private starting?: Promise<NativeInspectorSnapshot>;
  private port = 4319;
  private revision = 0;
  private rules: NativeOverride[] = [];
  private events: NativeNetworkEvent[] = [];
  private clients = new Map<string, NativeInspectorSnapshot["clients"][number]>();

  snapshot(): NativeInspectorSnapshot {
    return { running: Boolean(this.server?.listening), port: this.port, revision: this.revision,
      clients: [...this.clients.values()], events: this.events };
  }

  setRules(value: unknown): void {
    if (!Array.isArray(value) || value.length > 100 || JSON.stringify(value).length > MAX_BODY)
      throw new Error("오버라이드는 100개, 전체 256KB까지 지원합니다.");
    for (const rule of value) {
      if (!record(rule) || typeof rule.id !== "string" || typeof rule.clientId !== "string"
        || !/^[\w.-]{1,80}$/.test(rule.clientId)
        || typeof rule.match !== "string" || typeof rule.method !== "string" || typeof rule.enabled !== "boolean"
        || !Number.isInteger(rule.status) || Number(rule.status) < 200 || Number(rule.status) > 599)
        throw new Error("오버라이드의 앱, 경로, 메서드와 상태 코드(200–599)를 확인해 주세요.");
      if (!/^https?:\/\//.test(rule.match)) throw new Error("모바일 규칙은 호스트를 포함한 HTTP(S) 주소를 사용합니다.");
      new URL(rule.match);
    }
    this.rules = structuredClone(value) as NativeOverride[];
    this.revision += 1;
  }

  clearEvents(): void { this.events = []; }

  async start(port = 4319): Promise<NativeInspectorSnapshot> {
    if (this.starting) return this.starting;
    if (this.server?.listening) return this.snapshot();
    this.starting = new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        const reply = (status: number, value: unknown) => {
          response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify(value));
        };
        // This is a local native-app bridge, never a browser or LAN endpoint.
        if (request.headers.origin || !/^127\.0\.0\.1:\d+$/.test(request.headers.host || "")
          || request.headers["x-checkly-native"] !== "1") { reply(403, { error: "Local native clients only" }); return; }
        void this.handle(request).then(value => reply(200, value)).catch(error => {
          reply(400, { error: error instanceof Error ? error.message : "Invalid request" });
        });
      });
      server.requestTimeout = 5000;
      server.headersTimeout = 5000;
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        this.server = server;
        const address = server.address();
        this.port = typeof address === "object" && address ? address.port : port;
        resolve(this.snapshot());
      });
    });
    try { return await this.starting; } finally { this.starting = undefined; }
  }

  async stop(): Promise<void> {
    if (this.starting) { try { await this.starting; } catch { return; } }
    const server = this.server;
    this.server = undefined;
    this.clients.clear();
    if (server) {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
  }

  private async handle(request: IncomingMessage): Promise<unknown> {
    if (request.method !== "POST" || !["/sync", "/events"].includes(request.url || "")) throw new Error("Unknown endpoint");
    if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("JSON required");
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error("Payload too large");
      chunks.push(chunk);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!record(input) || typeof input.clientId !== "string" || !/^[\w.-]{1,80}$/.test(input.clientId)
      || typeof input.name !== "string" || !input.name.length || input.name.length > 100) throw new Error("Invalid client");
    if (!this.clients.has(input.clientId) && this.clients.size >= 20) throw new Error("Too many clients");
    this.clients.set(input.clientId, { id: input.clientId, name: input.name, lastSeen: Date.now(), revision: Number(input.revision) || 0 });
    if (request.url === "/sync") return { revision: this.revision, rules: this.rules.filter(rule => rule.clientId === input.clientId && rule.enabled) };
    const event = input.event;
    if (!record(event) || typeof event.url !== "string" || event.url.length > 8192 || !/^https?:\/\//.test(event.url)
      || typeof event.method !== "string" || event.method.length > 20 || !Number.isInteger(event.status)
      || Number(event.status) < 0 || Number(event.status) > 599 || !Number.isFinite(event.elapsed)) throw new Error("Invalid event");
    this.events.unshift({ id: randomUUID(), type: "fetch", url: event.url, method: event.method,
      status: Number(event.status), elapsed: Math.max(0, Number(event.elapsed)), requestBody: event.requestBody,
      responseBody: event.responseBody, responseContentType: String(event.responseContentType || "").slice(0, 200),
      overridden: event.overridden === true, ruleRevision: Number(input.revision) || 0, error: typeof event.error === "string" ? event.error.slice(0, 2000) : undefined,
      at: new Date().toISOString(), browserSessionId: input.clientId, browserSessionName: input.name });
    this.events = this.events.slice(0, 300);
    while (this.events.length > 1 && JSON.stringify(this.events).length > 2 * 1024 * 1024) this.events.pop();
    return { ok: true };
  }
}
