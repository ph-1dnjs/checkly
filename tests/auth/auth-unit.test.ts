import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuthFailure, MESSAGES, toUserMessage } from "../../src/app/ipc/auth/errors";
import { authEmail, readAuthEnv } from "../../src/app/ipc/auth/service";
import { fromRows, normalizeSettings, toSavePayload } from "../../src/app/ipc/auth/settings";
import { createFileStorage, type SessionCipher } from "../../src/app/ipc/auth/storage";
import type { ProjectSettings } from "../../src/app/ipc/auth/types";

const silently = <T>(run: () => T): T => {
  const original = console.error;
  console.error = () => undefined;
  try {
    return run();
  } finally {
    console.error = original;
  }
};

test("login email and env config", () => {
  assert.equal(authEmail("kim", "my-team", "checkly.test"), "kim.my-team@checkly.test");
  assert.equal(readAuthEnv({}), null);
  assert.equal(readAuthEnv({ CHECKLY_SUPABASE_URL: "http://x" }), null);
  assert.deepEqual(readAuthEnv({ CHECKLY_SUPABASE_URL: " http://x ", CHECKLY_SUPABASE_ANON_KEY: "k" }), {
    url: "http://x",
    anonKey: "k",
    emailDomain: "checkly.test",
  });
  assert.equal(readAuthEnv({ CHECKLY_SUPABASE_URL: "u", CHECKLY_SUPABASE_ANON_KEY: "k", CHECKLY_AUTH_EMAIL_DOMAIN: "a.io" })?.emailDomain, "a.io");

  // 패키징된 앱의 기본 서버: 환경 변수가 없을 때만 쓰고, 빈 값으로 두면 로컬 모드로 끈다.
  const release = { url: "https://r.supabase.co", anonKey: "rk", emailDomain: "checkly.test" };
  assert.deepEqual(readAuthEnv({}, release), release);
  assert.equal(readAuthEnv({ CHECKLY_SUPABASE_URL: "" }, release), null);
  assert.equal(readAuthEnv({ CHECKLY_SUPABASE_URL: "http://x", CHECKLY_SUPABASE_ANON_KEY: "k" }, release)?.url, "http://x");
});

test("errors map to Korean messages", () => {
  assert.equal(toUserMessage(new AuthFailure("그대로")), "그대로");
  assert.equal(toUserMessage({ name: "AuthApiError", code: "invalid_credentials", status: 400, message: "Invalid login credentials" }), MESSAGES.badCredentials);
  assert.equal(toUserMessage({ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }), MESSAGES.network);
  assert.equal(toUserMessage({ name: "PostgrestError", code: "", message: "TypeError: fetch failed" }), MESSAGES.network);
  assert.equal(toUserMessage({ name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" }), MESSAGES.network);
  assert.equal(toUserMessage({ code: "42501", message: "owner_only" }), MESSAGES.forbidden);
  assert.equal(toUserMessage({ code: "42501", message: 'new row violates row-level security policy for table "endpoints"' }), MESSAGES.forbidden);
  assert.equal(toUserMessage({ code: "P0001", message: "settings_conflict" }), MESSAGES.conflict);
  assert.equal(toUserMessage({ code: "weak_password", message: "Password should be at least 6 characters." }), MESSAGES.shortPassword);
  assert.equal(toUserMessage({ status: 429, code: "over_request_rate_limit", message: "rate limit" }), MESSAGES.rateLimited);
  assert.equal(silently(() => toUserMessage(new Error("something odd"))), MESSAGES.unknown);
});

const endpointA = randomUUID(), endpointB = randomUUID(), dev = randomUUID(), prod = randomUUID();
const sample = (): ProjectSettings => ({
  endpoints: [
    { id: endpointA, name: " 프론트 ", kind: "web", position: 0 },
    { id: endpointB, name: "백엔드", kind: "api", position: 1 },
  ],
  environments: [
    { id: dev, name: "dev", position: 0 },
    { id: prod, name: "prod", position: 1 },
  ],
  urls: [
    { endpointId: endpointA, environmentId: dev, baseUrl: " https://dev.app.com ", specUrl: "https://ignored" },
    { endpointId: endpointB, environmentId: dev, baseUrl: "https://dev-api.app.com", specUrl: "https://dev-api.app.com/docs.json" },
    { endpointId: endpointB, environmentId: prod, baseUrl: "", specUrl: "" },
  ],
});

const rejects = (settings: ProjectSettings, pattern: RegExp): void =>
  assert.throws(() => normalizeSettings(settings), (error: unknown) => error instanceof AuthFailure && pattern.test(error.message));

test("settings validation: trims, drops empty cells, allows missing pairs, keeps spec only for api", () => {
  const clean = normalizeSettings(sample());
  assert.equal(clean.endpoints[0].name, "프론트");
  assert.equal(clean.urls.length, 2);
  assert.deepEqual(clean.urls[0], { endpointId: endpointA, environmentId: dev, baseUrl: "https://dev.app.com", specUrl: null });
  assert.equal(clean.urls[1].specUrl, "https://dev-api.app.com/docs.json");
  assert.deepEqual(normalizeSettings({ endpoints: [], environments: [], urls: [] }), { endpoints: [], environments: [], urls: [] });
});

test("settings validation: rejects bad rows with Korean messages", () => {
  const s = sample();
  rejects({ ...s, endpoints: [{ ...s.endpoints[0], name: "  " }, s.endpoints[1]] }, /엔드포인트 이름을 입력하세요/);
  rejects({ ...s, environments: [s.environments[0], { ...s.environments[1], name: "dev" }] }, /환경 이름이 겹칩니다: dev/);
  rejects({ ...s, endpoints: [{ ...s.endpoints[0], kind: "db" as never }, s.endpoints[1]] }, /web 또는 api/);
  rejects({ ...s, endpoints: [{ ...s.endpoints[0], id: "x" }, s.endpoints[1]] }, /ID가 올바르지 않습니다/);
  rejects({ ...s, urls: [{ endpointId: endpointA, environmentId: dev, baseUrl: "ftp://x", specUrl: null }] }, /프론트 · dev 주소는 http/);
  rejects({ ...s, urls: [{ endpointId: endpointB, environmentId: dev, baseUrl: "https://a", specUrl: "docs.json" }] }, /스웨거 주소/);
  rejects({ ...s, urls: [{ endpointId: randomUUID(), environmentId: dev, baseUrl: "https://a", specUrl: null }] }, /없는 엔드포인트나 환경/);
  rejects({ ...s, urls: [s.urls[0], s.urls[0]] }, /두 번/);
});

test("save payload: snake_case rows and deletions only for rows that were read", () => {
  const known: ProjectSettings = fromRows(
    [
      { id: endpointA, name: "프론트", kind: "web", position: 0, updated_at: "t1" },
      { id: endpointB, name: "백엔드", kind: "api", position: 1, updated_at: "t2" },
    ],
    [{ id: dev, name: "dev", position: 0, updated_at: "t3" }],
    [
      { endpoint_id: endpointA, environment_id: dev, base_url: "https://a", spec_url: null, updated_at: "t4" },
      { endpoint_id: endpointB, environment_id: dev, base_url: "https://b", spec_url: null, updated_at: "t5" },
      // 따로 읽는 사이에 지워진 환경의 주소는 빠진다.
      { endpoint_id: endpointB, environment_id: prod, base_url: "https://c", spec_url: null, updated_at: "t6" },
    ],
  );
  assert.equal(known.urls.length, 2);
  const next: ProjectSettings = {
    endpoints: [known.endpoints[0]],
    environments: [...known.environments, { id: prod, name: "prod", position: 1 }],
    urls: [known.urls[0]],
  };
  const payload = toSavePayload(next, known);
  assert.deepEqual(payload.endpoints, [{ id: endpointA, name: "프론트", kind: "web", position: 0, updated_at: "t1" }]);
  assert.deepEqual(payload.environments[1], { id: prod, name: "prod", position: 1, updated_at: null });
  assert.deepEqual(payload.deleted.endpoints.map(e => [e.id, e.updated_at]), [[endpointB, "t2"]]);
  assert.deepEqual(payload.deleted.environments, []);
  assert.deepEqual(payload.deleted.urls.map(u => u.updated_at), ["t5"]);
  // 읽은 적이 없으면 지울 행도 없다(모르는 행은 SQL이 충돌로 거절).
  assert.deepEqual(toSavePayload(next, null).deleted, { endpoints: [], environments: [], urls: [] });
});

const fakeCipher = (available: boolean): SessionCipher => ({
  isEncryptionAvailable: () => available,
  encryptString: plain => Buffer.from(Buffer.from(plain, "utf8").map(byte => byte ^ 0x5a)),
  decryptString: encrypted => Buffer.from(encrypted.map(byte => byte ^ 0x5a)).toString("utf8"),
});

test("session storage: encrypted file, restored by a new instance, memory only without encryption", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-auth-storage-"));
  try {
    const file = path.join(dir, "auth-session.json");
    const storage = createFileStorage(file, fakeCipher(true));
    await storage.setItem("checkly-auth", '{"access_token":"secret-token"}');
    assert.equal((await readFile(file)).includes(Buffer.from("secret-token")), false);
    assert.equal(await createFileStorage(file, fakeCipher(true)).getItem("checkly-auth"), '{"access_token":"secret-token"}');
    await storage.removeItem("checkly-auth");
    await assert.rejects(readFile(file));

    const plainFile = path.join(dir, "plain.json");
    const memory = createFileStorage(plainFile, fakeCipher(false));
    await memory.setItem("checkly-auth", "secret-token");
    assert.equal(await memory.getItem("checkly-auth"), "secret-token");
    await assert.rejects(readFile(plainFile));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
