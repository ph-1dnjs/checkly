import { readFileSync, renameSync, chmodSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { randomUUID } from "node:crypto";

/** Probe the authenticated MCP identity, never a PID or an arbitrary remote URL. */
async function activeCheckly(value: unknown, file: string): Promise<boolean> {
  const record = value as { url?: unknown; token?: unknown } | null;
  if (!record || typeof record.url !== "string" || typeof record.token !== "string" || !/^[a-f0-9]{64}$/.test(record.token)) return false;
  let url: URL;
  try { url = new URL(record.url); } catch { return false; }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/mcp" || url.search || url.hash || url.username || url.password) return false;
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${record.token}`,
    } }, res => {
      // A live Checkly accepts the token it published, so a rejected token means the record is stale.
      if (res.statusCode === 401 || res.statusCode === 403) { res.resume(); resolve(false); return; }
      let text = "";
      res.on("data", chunk => {
        text += chunk.toString();
        if (Buffer.byteLength(text) > 32_000) { res.destroy(); reject(new Error("기존 MCP 연결 응답을 확인할 수 없습니다")); }
      });
      res.on("error", reject);
      res.on("end", () => {
        try {
          const result = JSON.parse(text);
          resolve(res.statusCode === 200 && result.jsonrpc === "2.0" && result.id === id && result.result?.serverInfo?.name === "checkly-api-testing");
        } catch { resolve(false); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error(`기존 MCP 연결 확인 시간이 초과되었습니다. 다른 Checkly 앱이 없다면 ${file}을 지운 뒤 다시 켜세요`)), 2_000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", error => {
      if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    req.end(JSON.stringify({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "checkly-discovery", version: "1" } } }));
  });
}

/** Preserve corrupt files and never retire a record replaced while its endpoint was checked. */
export async function releaseStaleDiscovery(file: string, stillCurrent: () => void): Promise<void> {
  let snapshot: string;
  let inode: number;
  try { snapshot = readFileSync(file, "utf8"); inode = statSync(file).ino; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  let value: unknown;
  let corrupt = false;
  try { value = JSON.parse(snapshot); } catch { corrupt = true; }
  if (!corrupt && await activeCheckly(value, file)) throw new Error("다른 Checkly MCP 연결이 있습니다. 해당 앱에서 연결을 먼저 끄세요");
  stillCurrent();
  try {
    if (statSync(file).ino !== inode || readFileSync(file, "utf8") !== snapshot) throw new Error("MCP 접속 정보가 변경되었습니다. 다시 시도하세요");
    if (corrupt) {
      const backup = `${file}.corrupt-${randomUUID()}`;
      renameSync(file, backup);
      chmodSync(backup, 0o600);
    } else rmSync(file);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
