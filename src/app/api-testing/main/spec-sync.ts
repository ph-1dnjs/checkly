import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { httpUrl, specSourceSchema } from "../shared/workspace";
import type { ApiScope, ApiSpecSync } from "../shared/workspace";
import { ApiWorkspace, scopeSchema } from "./workspace";

type SecretStorage = { available(): boolean; encrypt(value: string): string; decrypt(value: string): string };
const storedSchema = z.object({ url: httpUrl.optional(), username: z.string().optional(), encrypted: z.string().optional(), lastAttemptAt: z.string().optional(), lastSuccessAt: z.string().optional(), status: z.enum(["success", "failed"]).optional() }).strict();
type Stored = z.infer<typeof storedSchema>;

export class SpecSync {
  private active = new Set<string>();
  constructor(private directory: string, private workspace: ApiWorkspace, private secrets: SecretStorage) {}
  private filename(input: ApiScope) {
    const s = scopeSchema.parse(input);
    return path.join(this.directory, `spec-source-${s.projectId}-${s.environmentId}-${s.serverId}.json`);
  }
  private async read(scope: ApiScope): Promise<Stored> {
    await this.workspace.getCatalog(scope); // Validate the full scope before touching credentials.
    try { return storedSchema.parse(JSON.parse(await readFile(this.filename(scope), "utf8"))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("명세 동기화 설정을 읽지 못했습니다"); }
  }
  private async save(scope: ApiScope, data: Stored) {
    await mkdir(this.directory, { recursive: true });
    const temp = path.join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
    await rename(temp, this.filename(scope));
  }
  /**
   * In a team project the URL is the team's, and so is a remembered account while the team shares
   * secrets; otherwise the account (keychain) and the sync status stay on this computer.
   */
  async get(scope: ApiScope): Promise<ApiSpecSync> {
    const { encrypted, ...metadata } = await this.read(scope);
    const shared = await this.workspace.sharedSpecUrl(scope);
    const team = await this.workspace.sharedSpecAccount(scope).catch(() => undefined);
    return {
      ...metadata, ...(shared !== undefined ? { url: shared ?? undefined } : {}),
      ...(team?.account ? { username: team.account.username, teamAccount: true } : {}),
      hasSavedAccount: Boolean(encrypted) || Boolean(team?.account), secureStorageAvailable: this.secrets.available(),
      ...(team?.sharing ? { shareAccount: true } : {}),
    };
  }
  async deleteAccount(scope: ApiScope) {
    const key = this.filename(scope);
    if (this.active.has(key)) throw new Error("명세 동기화 중에는 계정을 삭제할 수 없습니다");
    const release = this.workspace.beginSpecSync(scope);
    this.active.add(key);
    try {
      const { encrypted, username, ...rest } = await this.read(scope); await this.save(scope, rest);
      await this.workspace.forgetSharedSpecAccount(scope);
    } finally { this.active.delete(key); release(); }
  }
  async importUrl(scope: ApiScope, rawSource: unknown) {
    const parsed = specSourceSchema.safeParse(rawSource);
    if (!parsed.success || parsed.data.kind !== "url") {
      const url = (rawSource as { url?: unknown } | null)?.url;
      throw new Error(typeof url === "string" && !/^https?:\/\/[^\s]+$/i.test(url.trim()) ? "http:// 또는 https://로 시작하는 명세 주소를 입력하세요" : "명세 주소와 인증 입력을 확인하세요");
    }
    const source = parsed.data;
    const key = this.filename(scope);
    if (this.active.has(key)) throw new Error("이 명세를 이미 동기화하고 있습니다");
    const release = this.workspace.beginSpecSync(scope);
    this.active.add(key);
    let catalog: Awaited<ReturnType<ApiWorkspace["importSpec"]>>;
    // Team project sharing secrets: the remembered account is the team's (no keychain needed).
    let shareAccount: { url: string; username: string; password: string } | undefined;
    try {
      const previous = await this.read(scope);
      const team = await this.workspace.sharedSpecAccount(scope).catch(() => undefined);
      const attempt = new Date().toISOString();
      try {
        let auth = source.auth;
        let encrypted: string | undefined;
        if (source.useSavedAuth && !auth && team?.account?.url === source.url) {
          auth = { kind: "basic", username: team.account.username, password: team.account.password };
          if (previous.url === source.url) encrypted = previous.encrypted;
        } else if (source.useSavedAuth) {
          if (auth || source.url !== previous.url || !previous.encrypted || !previous.username) throw new Error("저장된 계정은 저장 당시의 명세 주소에서만 사용할 수 있습니다");
          if (!this.secrets.available()) throw new Error("OS 보안 저장소를 사용할 수 없습니다. 계정을 다시 입력하세요");
          try { auth = { kind: "basic", username: previous.username, password: this.secrets.decrypt(previous.encrypted) }; }
          catch { throw new Error("저장된 계정을 복호화하지 못했습니다. 계정을 삭제하고 다시 입력하세요"); }
          encrypted = previous.encrypted;
        } else if (source.remember && team?.sharing) {
          if (!auth) throw new Error("저장할 Basic 인증 계정을 입력하세요");
          shareAccount = { url: source.url, username: auth.username, password: auth.password };
        } else if (source.remember) {
          if (!auth) throw new Error("저장할 Basic 인증 계정을 입력하세요");
          if (!this.secrets.available()) throw new Error("OS 보안 저장소를 사용할 수 없어 계정을 저장하지 않았습니다");
          try { encrypted = this.secrets.encrypt(auth.password); }
          catch { throw new Error("계정을 안전하게 암호화하지 못했습니다"); }
        }
        let response: Response;
        try { response = await fetch(source.url, { headers: auth ? { Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64")}` } : undefined, signal: AbortSignal.timeout(30_000), redirect: "error" }); }
        catch { throw new Error("명세 URL에 연결할 수 없습니다. 직접 JSON/YAML 주소를 확인하세요"); }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error([401,403].includes(response.status) ? `명세 인증 실패: HTTP ${response.status}. 문서용 아이디·비밀번호와 접근 권한을 확인하세요` : `명세 가져오기 실패: HTTP ${response.status}${response.status === 404 ? ". 명세 주소를 확인하세요" : ""}`);
        }
        if (!response.body) throw new Error("명세 응답이 비어 있습니다");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 5_000_000) throw new Error("명세는 5MB 이하만 지원합니다"); chunks.push(chunk.value); } }
        finally { await reader.cancel().catch(() => undefined); }
        const text = Buffer.concat(chunks).toString("utf8");
        // A Swagger UI page instead of the document it shows: the usual mistake, said plainly.
        if (/^\s*</.test(text)) throw new Error("명세 대신 웹 페이지(HTML)를 받았습니다. Swagger 화면 주소가 아니라 /v3/api-docs 같은 JSON·YAML 명세 주소를 넣으세요");
        catalog = await this.workspace.importSpec(scope, text);
        await this.save(scope, { url: source.url, username: auth?.username, encrypted, lastAttemptAt: attempt, lastSuccessAt: catalog.importedAt, status: "success" });
      } catch (e) {
        await this.save(scope, { ...previous, lastAttemptAt: attempt, status: "failed" });
        throw e;
      }
    } finally { this.active.delete(key); release(); }
    // A URL that worked becomes the team's; the spec itself was imported either way.
    try { await this.workspace.shareSpecUrl(scope, source.url); }
    catch (e) { throw new Error(`명세는 가져왔지만 팀 프로젝트에 명세 주소를 저장하지 못했습니다. ${(e as Error).message}`); }
    if (shareAccount) {
      try { await this.workspace.shareSpecAccount(scope, shareAccount); }
      catch (e) { throw new Error(`명세는 가져왔지만 문서 계정을 팀에 저장하지 못했습니다. ${(e as Error).message}`); }
    }
    return catalog;
  }
}
