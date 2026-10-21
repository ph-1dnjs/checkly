import type { RecordingBatch, ReplayEvent } from "./types";

export const BEFORE_ERROR_MS = 5_000;
export const AFTER_ERROR_MS = 5_000;
export const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
type Chunk = { at: number; bytes: number; events: ReplayEvent[] };
type DocumentBuffer = { title: string; url: string; meta?: ReplayEvent; chunks: Chunk[]; lastAt: number };

// Keep a reconstructable snapshot preceding the window, rather than truncating
// arbitrary DOM mutations that can no longer be replayed on their own.
export class ReplayBuffer {
  private documents = new Map<string, DocumentBuffer>();
  private bytes = 0;

  add(batch: RecordingBatch, now = Date.now()): void {
    let document = this.documents.get(batch.documentId);
    if (!document) {
      document = { title: batch.title, url: batch.url, chunks: [], lastAt: now };
      this.documents.set(batch.documentId, document);
    }
    document.title = batch.title;
    document.url = batch.url;
    for (const event of batch.events) {
      document.lastAt = event.timestamp;
      if (event.type === 4) { document.meta = event; continue; }
      if (event.type === 2) {
        const events = document.meta ? [{ ...document.meta, timestamp: event.timestamp }, event] : [event];
        const bytes = Buffer.byteLength(JSON.stringify(events));
        document.chunks.push({ at: event.timestamp, bytes, events });
        this.bytes += bytes;
      } else {
        const chunk = document.chunks.at(-1);
        if (!chunk) continue;
        const bytes = Buffer.byteLength(JSON.stringify(event));
        chunk.events.push(event); chunk.bytes += bytes; this.bytes += bytes;
      }
    }
    this.prune(now);
  }

  private prune(now: number): void {
    const cutoff = now - BEFORE_ERROR_MS;
    for (const [id, document] of this.documents) {
      while (document.chunks.length > 1 && document.chunks[1].at <= cutoff) {
        this.bytes -= document.chunks.shift()!.bytes;
      }
      if (document.lastAt < cutoff) {
        for (const chunk of document.chunks) this.bytes -= chunk.bytes;
        this.documents.delete(id);
      }
    }
    while (this.bytes > MAX_BUFFER_BYTES) {
      let oldest: DocumentBuffer | undefined;
      for (const document of this.documents.values()) {
        if (document.chunks.length && (!oldest || document.chunks[0].at < oldest.chunks[0].at)) oldest = document;
      }
      if (!oldest) break;
      this.bytes -= oldest.chunks.shift()!.bytes;
    }
  }

  snapshot(now = Date.now()): RecordingBatch[] {
    this.prune(now);
    return [...this.documents].flatMap(([documentId, document]) => {
      const events = document.chunks.flatMap(chunk => chunk.events).filter(event => event.timestamp <= now);
      return events.length ? [{ documentId, title: document.title, url: document.url, events: [...events] }] : [];
    });
  }
}
