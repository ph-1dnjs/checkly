import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LiveSession, RecordingBatch, SessionDocument, SessionRecording } from "./types";

export const MAX_SESSION_BYTES = 50 * 1024 * 1024;
export const safePageUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "about:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    // Query strings and fragments often contain tokens or personal data.
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
};

export class LocalSessionStore {
  constructor(private readonly root: string) {}

  private directory(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      throw new Error("올바르지 않은 세션 ID입니다.");
    }
    return path.join(this.root, id);
  }

  async create(title: string, url: string, source: LiveSession["source"]): Promise<LiveSession> {
    const session: LiveSession = {
      id: randomUUID(), title: title.slice(0, 200), url: safePageUrl(url), source,
      startedAt: Date.now(), status: "recording", eventCount: 0, bytes: 0,
    };
    await mkdir(this.directory(session.id), { recursive: true });
    await writeFile(path.join(this.directory(session.id), "events.jsonl"), "");
    await this.save(session);
    return session;
  }

  async save(session: LiveSession): Promise<void> {
    const target = path.join(this.directory(session.id), "session.json");
    await writeFile(`${target}.tmp`, JSON.stringify(session));
    await rename(`${target}.tmp`, target);
  }

  async append(session: LiveSession, batch: RecordingBatch): Promise<void> {
    const line = `${JSON.stringify({ ...batch, url: safePageUrl(batch.url) })}\n`;
    const bytes = Buffer.byteLength(line);
    if (session.bytes + bytes > MAX_SESSION_BYTES) throw new Error("로컬 기록 한도(50MB)에 도달해 기록을 종료했습니다.");
    await appendFile(path.join(this.directory(session.id), "events.jsonl"), line);
    session.bytes += bytes;
    session.eventCount += batch.events.length;
  }

  async list(activeIds = new Set<string>()): Promise<LiveSession[]> {
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    const sessions: LiveSession[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let session: LiveSession;
      try {
        session = JSON.parse(await readFile(path.join(this.directory(entry.name), "session.json"), "utf8"));
      } catch { continue; /* Incomplete or unrelated directories are not recordings. */ }
      if (session.status === "recording" && !activeIds.has(session.id)) {
        const recording = await this.read(session.id);
        session = { ...recording.session, status: "interrupted" };
      }
      sessions.push(session);
    }
    return sessions.sort((a, b) => b.startedAt - a.startedAt);
  }

  async read(id: string): Promise<SessionRecording> {
    const directory = this.directory(id);
    const session: LiveSession = JSON.parse(await readFile(path.join(directory, "session.json"), "utf8"));
    if ((await stat(path.join(directory, "events.jsonl"))).size > MAX_SESSION_BYTES) throw new Error("기록 파일이 너무 큽니다.");
    const text = await readFile(path.join(directory, "events.jsonl"), "utf8");
    const documents = new Map<string, SessionDocument>();
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]) continue;
      let batch: RecordingBatch;
      try { batch = JSON.parse(lines[index]); }
      catch {
        if (index === lines.length - 1) break; // Recover the last incomplete write after a crash.
        throw new Error("기록 파일 일부가 손상되었습니다.");
      }
      let document = documents.get(batch.documentId);
      if (!document) {
        document = { id: batch.documentId, title: batch.title, url: batch.url, events: [] };
        documents.set(document.id, document);
      }
      document.events.push(...batch.events);
    }
    for (const document of documents.values()) document.events.sort((a, b) => a.timestamp - b.timestamp);
    session.eventCount = [...documents.values()].reduce((sum, document) => sum + document.events.length, 0);
    session.bytes = Buffer.byteLength(text);
    if (session.status === "recording") session.status = "interrupted";
    return { session, documents: [...documents.values()] };
  }

  async remove(id: string): Promise<void> {
    await rm(this.directory(id), { recursive: true, force: true });
  }
}
