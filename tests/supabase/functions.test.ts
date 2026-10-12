// 팀 프로젝트 계정 Edge Function + RLS 통합 테스트. 로컬 Supabase(`supabase start`)와 함수 서빙이 필요하다.
// 연결할 수 없으면 건너뛴다. URL·anon 키는 .env(또는 환경 변수), service_role 키는 `supabase status -o env`에서 읽는다.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { localCreateCode } from "../fixtures/create-code";

const root = path.resolve(__dirname, "../..");
const fileEnv: Record<string, string> = (() => {
  try {
    const pairs = readFileSync(path.join(root, ".env"), "utf8").split("\n").map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/));
    return Object.fromEntries(pairs.filter((m) => m).map((m) => [m![1], m![2]]));
  } catch {
    return {};
  }
})();
const env = (name: string) => process.env[name] || fileEnv[name] || "";
const url = env("CHECKLY_SUPABASE_URL") || "http://127.0.0.1:54321";
const anonKey = env("CHECKLY_SUPABASE_ANON_KEY");
const domain = env("CHECKLY_AUTH_EMAIL_DOMAIN") || "checkly.test";
const options = { auth: { persistSession: false, autoRefreshToken: false } };

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const out = execFileSync("supabase", ["status", "-o", "env"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 });
    return out.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m)?.[1] ?? "";
  } catch {
    return "";
  }
}

async function skipReason() {
  if (!anonKey) return "CHECKLY_SUPABASE_ANON_KEY가 없습니다";
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(2000) });
    if (!res.ok) return `Supabase Auth 응답 ${res.status}`;
  } catch {
    return `로컬 Supabase(${url})에 연결할 수 없습니다`;
  }
  return "";
}

type Result = { status: number; body: any };
const anon = () => createClient(url, anonKey, options);
const email = (nickname: string, code: string) => `${nickname}.${code}@${domain}`;
const newCode = () => `ck-${randomBytes(5).toString("hex")}`;
const PASSWORD = "secret1";

async function invoke(client: SupabaseClient, name: string, body: unknown): Promise<Result> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (!error) return { status: 200, body: data };
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    return { status: res.status, body: await res.json() };
  }
  throw error;
}

function assertError(result: Result, status: number, code: string) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  assert.match(result.body.error.message, /[가-힣]/);
}

async function signIn(nickname: string, code: string, password = PASSWORD) {
  const client = anon();
  const { data, error } = await client.auth.signInWithPassword({ email: email(nickname, code), password });
  return { client, userId: data.user?.id ?? "", error };
}

async function signedIn(nickname: string, code: string) {
  const session = await signIn(nickname, code);
  assert.ifError(session.error);
  return session;
}

test("팀 프로젝트 계정 Edge Function", async (t: TestContext) => {
  const reason = await skipReason();
  const key = reason ? "" : serviceKey();
  if (reason || !key) return t.skip(reason || "service_role 키를 읽지 못했습니다(supabase status)");
  // 함수 서빙(supabase functions serve)이 읽는 supabase/functions/.env와 같은 값.
  const createCode = localCreateCode();
  assert.ok(createCode, "supabase/functions/.env에 CHECKLY_CREATE_PROJECT_CODE가 필요합니다");

  const admin = createClient(url, key, options);
  const codes: string[] = [];
  t.after(async () => {
    const { data: projects } = await admin.from("projects").select("id").in("code", codes);
    const ids = (projects ?? []).map((p) => p.id);
    const { data: members } = await admin.from("members").select("user_id").in("project_id", ids);
    for (const m of members ?? []) await admin.auth.admin.deleteUser(m.user_id);
    if (ids.length) await admin.from("projects").delete().in("id", ids);
  });
  const create = async (code: string, nickname: string, password = PASSWORD) => {
    codes.push(code);
    return invoke(anon(), "create-project", { code, nickname, password, createCode });
  };
  const authUserExists = async (address: string) => {
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      assert.ifError(error);
      if (data.users.some((u) => u.email === address)) return true;
      if (data.users.length < 1000) return false;
    }
  };

  await t.test("생성 코드: 없거나 틀리면 403이고 auth 사용자를 만들지 않는다", async () => {
    const code = newCode();
    codes.push(code);
    const body = { code, nickname: "gate", password: PASSWORD };
    assertError(await invoke(anon(), "create-project", body), 403, "invalid_create_code");
    assertError(await invoke(anon(), "create-project", { ...body, createCode: "" }), 403, "invalid_create_code");
    assertError(await invoke(anon(), "create-project", { ...body, createCode: `${createCode}x` }), 403, "invalid_create_code");
    assertError(await invoke(anon(), "create-project", { ...body, createCode: 12345 }), 403, "invalid_create_code");
    const res = await invoke(anon(), "create-project", { ...body, createCode: "nope" });
    assert.equal(res.body.error.message, "생성 코드가 올바르지 않습니다. 운영자에게 문의하세요.");
    // 코드 확인이 다른 검증보다 먼저다(형식이 틀려도 같은 403).
    assertError(await invoke(anon(), "create-project", { code: "AB", nickname: "1x", password: "1", createCode: "nope" }), 403, "invalid_create_code");
    assert.equal(await authUserExists(email("gate", code)), false, "틀린 코드로 auth 사용자가 생기면 안 된다");
    assert.equal((await anon().rpc("project_code_available", { p_code: code })).data, true);

    // 맞는 코드면 만들어진다.
    const ok = await create(code, "gate");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(await authUserExists(email("gate", code)), true);
  });

  await t.test("공개 가입(auth signUp)은 config.toml에서 꺼 둔다", async () => {
    // 실행 중인 로컬 스택은 재시작해야 config.toml이 적용된다. 여기서는 설정 파일을 확인한다.
    const config = readFileSync(path.join(root, "supabase/config.toml"), "utf8");
    const auth = config.slice(config.indexOf("[auth]"), config.indexOf("[auth.rate_limit]"));
    const email_ = config.slice(config.indexOf("[auth.email]"), config.indexOf("[auth.sms]"));
    assert.match(auth, /^enable_signup = false$/m);
    assert.match(email_, /^enable_signup = false$/m);
  });

  const codeA = newCode();
  let projectA = "", inviteA = "";
  let owner: Awaited<ReturnType<typeof signedIn>>;
  let member: Awaited<ReturnType<typeof signedIn>>;

  await t.test("create-project → 로그인 이메일로 로그인 → 자기 프로젝트만 보인다", async () => {
    const res = await create(codeA, "minsu");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.projectId, /^[0-9a-f-]{36}$/);
    assert.match(res.body.inviteCode, /^[A-Z]{3}-[A-HJ-NP-Z2-9]{6}$/);
    ({ projectId: projectA, inviteCode: inviteA } = res.body);

    owner = await signedIn("minsu", codeA);
    const { data: projects } = await owner.client.from("projects").select("id, code, invite_code");
    assert.deepEqual(projects, [{ id: projectA, code: codeA, invite_code: inviteA }]);
    const { data: members } = await owner.client.from("members").select("nickname, role");
    assert.deepEqual(members, [{ nickname: "minsu", role: "owner" }]);
  });

  await t.test("초대코드 가입: preview_invite · nickname_available · join-project", async () => {
    const typed = `  ${inviteA.toLowerCase()} `;
    const { data: preview } = await anon().rpc("preview_invite", { p_invite: typed });
    assert.equal(preview?.length, 1);
    assert.equal(preview[0].project_code, codeA);
    assert.equal(preview[0].owner_nickname, "minsu");
    assert.equal(preview[0].member_count, 1);
    assert.equal((await anon().rpc("nickname_available", { p_invite: inviteA, p_nickname: "minsu" })).data, false);
    assert.equal((await anon().rpc("nickname_available", { p_invite: inviteA, p_nickname: "jisoo" })).data, true);

    const res = await invoke(anon(), "join-project", { inviteCode: typed, nickname: "jisoo", password: PASSWORD });
    assert.deepEqual(res, { status: 200, body: { projectId: projectA, projectCode: codeA } });

    member = await signedIn("jisoo", codeA);
    const { data: members } = await member.client.from("members").select("nickname, role").order("created_at");
    assert.deepEqual(members, [{ nickname: "minsu", role: "owner" }, { nickname: "jisoo", role: "member" }]);
    assert.equal((await anon().rpc("preview_invite", { p_invite: inviteA })).data?.[0].member_count, 2);
  });

  await t.test("중복 프로젝트 코드·닉네임 (동시 생성 포함)", async () => {
    assertError(await create(codeA, "other"), 409, "code_taken");
    assertError(await invoke(anon(), "join-project", { inviteCode: inviteA, nickname: "jisoo", password: PASSWORD }), 409, "nickname_taken");

    // 같은 코드를 동시에 만들면 하나만 성공하고, 진 쪽 auth 사용자는 지워진다.
    const code = newCode();
    const results = await Promise.all([create(code, "racer_a"), create(code, "racer_b")]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const lost = results.findIndex((r) => r.status === 409);
    assertError(results[lost], 409, "code_taken");
    const { error } = await signIn(lost === 0 ? "racer_a" : "racer_b", code);
    assert.ok(error, "진 쪽 계정은 남아 있으면 안 된다");

    // 같은 닉네임으로 동시에 가입해도 하나만 성공한다.
    const join = () => invoke(anon(), "join-project", { inviteCode: results[1 - lost].body.inviteCode, nickname: "twin", password: PASSWORD });
    const joins = await Promise.all([join(), join()]);
    assert.deepEqual(joins.map((r) => r.status).sort(), [200, 409]);
    assertError(joins.find((r) => r.status === 409)!, 409, "nickname_taken");

    // 두 멤버가 같은 닉네임으로 동시에 바꿔도 하나만 성공한다.
    const both = [await signedIn(lost === 0 ? "racer_b" : "racer_a", code), await signedIn("twin", code)];
    const renames = await Promise.all(both.map((s) => invoke(s.client, "change-nickname", { nickname: "same_nick" })));
    assert.deepEqual(renames.map((r) => r.status).sort(), [200, 409]);
    assertError(renames.find((r) => r.status === 409)!, 409, "nickname_taken");
  });

  await t.test("잘못된 초대코드·약한 비밀번호·형식 오류", async () => {
    for (const inviteCode of ["ZZZ-ZZZZZZ", "nope", ""]) {
      assertError(await invoke(anon(), "join-project", { inviteCode, nickname: "newbie", password: PASSWORD }), 404, "invalid_invite");
    }
    assertError(await create(newCode(), "minsu", "12345"), 400, "weak_password");
    assertError(await invoke(anon(), "join-project", { inviteCode: inviteA, nickname: "newbie", password: "12345" }), 400, "weak_password");
    assertError(await create("AB", "minsu"), 400, "invalid_input");
    assertError(await create(newCode(), "1minsu"), 400, "invalid_input");
    assertError(await invoke(anon(), "create-project", "not json"), 400, "invalid_input");
  });

  await t.test("change-nickname → 새 이메일로 로그인", async () => {
    assertError(await invoke(anon(), "change-nickname", { nickname: "jisoo2" }), 401, "unauthorized");
    assertError(await invoke(member.client, "change-nickname", { nickname: "minsu" }), 409, "nickname_taken");
    assertError(await invoke(member.client, "change-nickname", { nickname: "Bad Name" }), 400, "invalid_input");

    assert.deepEqual(await invoke(member.client, "change-nickname", { nickname: "jisoo2" }), { status: 200, body: { nickname: "jisoo2" } });
    const renamed = await signedIn("jisoo2", codeA);
    assert.equal(renamed.userId, member.userId);
    const { data: user } = await admin.auth.admin.getUserById(member.userId);
    assert.equal(user.user?.email, email("jisoo2", codeA));
    assert.ok(user.user?.email_confirmed_at);
    const { data: row } = await admin.from("members").select("nickname").eq("user_id", member.userId).single();
    assert.equal(row?.nickname, "jisoo2");
  });

  const codeB = newCode();
  let projectB = "";
  let ownerB: Awaited<ReturnType<typeof signedIn>>;

  await t.test("remove-member: 관리자만, 관리자 자신·다른 프로젝트 멤버는 안 된다", async () => {
    const res = await create(codeB, "yuna");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    projectB = res.body.projectId;
    ownerB = await signedIn("yuna", codeB);

    assertError(await invoke(member.client, "remove-member", { userId: owner.userId }), 403, "owner_only");
    assertError(await invoke(owner.client, "remove-member", { userId: owner.userId }), 403, "cannot_remove_owner");
    assertError(await invoke(owner.client, "remove-member", { userId: ownerB.userId }), 404, "not_found");
    assertError(await invoke(owner.client, "remove-member", { userId: "x" }), 400, "invalid_input");

    assert.deepEqual(await invoke(owner.client, "remove-member", { userId: member.userId }), { status: 200, body: {} });
    const { error } = await admin.auth.admin.getUserById(member.userId);
    assert.ok(error, "내보낸 멤버의 auth 사용자는 지워진다");
    const { data: members } = await owner.client.from("members").select("nickname");
    assert.deepEqual(members, [{ nickname: "minsu" }]);
    // 지워진 사용자의 JWT로는 더 호출할 수 없다.
    assertError(await invoke(member.client, "change-nickname", { nickname: "ghost" }), 401, "unauthorized");
  });

  await t.test("프로젝트 B 멤버는 A의 행을 읽거나 쓰지 못한다", async () => {
    const { data: endpoint, error } = await owner.client.from("endpoints").insert({ project_id: projectA, name: "백엔드", kind: "api" }).select("id").single();
    assert.ifError(error);

    const b = ownerB.client;
    assert.deepEqual((await b.from("projects").select("id")).data, [{ id: projectB }]);
    assert.deepEqual((await b.from("projects").select("id").eq("id", projectA)).data, []);
    assert.deepEqual((await b.from("members").select("user_id").eq("project_id", projectA)).data, []);
    assert.deepEqual((await b.from("endpoints").select("id")).data, []);
    const insert = await b.from("endpoints").insert({ project_id: projectA, name: "침입", kind: "web" });
    assert.equal(insert.error?.code, "42501");
    const update = await b.from("endpoints").update({ name: "변경" }).eq("id", endpoint!.id).select("id");
    assert.deepEqual(update.data, []);
    // anon은 테이블을 직접 읽지 못한다.
    assert.equal((await anon().from("projects").select("id").eq("id", projectA)).data?.length ?? 0, 0);
  });
});
