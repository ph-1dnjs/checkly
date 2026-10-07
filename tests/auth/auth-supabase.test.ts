import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { MESSAGES, toUserMessage } from "../../src/app/ipc/auth/errors";
import { AuthService, authEmail } from "../../src/app/ipc/auth/service";
import { createFileStorage, type SessionCipher } from "../../src/app/ipc/auth/storage";
import type { AuthSession, ProjectSettings } from "../../src/app/ipc/auth/types";

// 로컬 Supabase(`supabase start`)에 붙여 AuthService를 검증한다. 연결할 수 없으면 건너뛴다.
// service_role 키는 실행할 때 `supabase status -o env`에서 읽는다(파일에 남기지 않음).

const ROOT = path.resolve(__dirname, "../..");
const DOMAIN = process.env.CHECKLY_AUTH_EMAIL_DOMAIN?.trim() || "checkly.test";

type Local = { url: string; anonKey: string; serviceKey: string };

const localSupabase = async (): Promise<Local | null> => {
  try {
    const out = execFileSync("supabase", ["status", "-o", "env"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const env = Object.fromEntries(
      out.split("\n").map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(m => m !== null).map(m => [m![1], m![2]]),
    );
    if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) return null;
    const response = await fetch(`${env.API_URL}/auth/v1/health`, { headers: { apikey: env.ANON_KEY }, signal: AbortSignal.timeout(3000) });
    return response.ok ? { url: env.API_URL, anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY } : null;
  } catch {
    return null;
  }
};

const functionsServed = async (local: Local): Promise<boolean> => {
  try {
    const response = await fetch(`${local.url}/functions/v1/create-project`, {
      method: "POST",
      headers: { Authorization: `Bearer ${local.anonKey}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return body?.error?.code === "invalid_input";
  } catch {
    return false;
  }
};

const cipher: SessionCipher = {
  isEncryptionAvailable: () => true,
  encryptString: plain => Buffer.from(plain, "utf8").reverse(),
  decryptString: encrypted => Buffer.from(encrypted).reverse().toString("utf8"),
};

const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

const fails = async (promise: Promise<unknown>, message: string | RegExp): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    const text = toUserMessage(error);
    if (typeof message === "string") assert.equal(text, message);
    else assert.match(text, message);
    return true;
  });
};

test("AuthService against local Supabase", async t => {
  const local = await localSupabase();
  if (!local) {
    t.skip("로컬 Supabase에 연결할 수 없어 건너뜀");
    return;
  }
  const admin = createClient(local.url, local.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userIds: string[] = [];
  const projectIds: string[] = [];
  const dirs: string[] = [];

  const newService = async (dataDir?: string) => {
    const dir = dataDir ?? (await mkdtemp(path.join(tmpdir(), "checkly-auth-it-")));
    if (!dataDir) dirs.push(dir);
    const events: (AuthSession | null)[] = [];
    const service = new AuthService({
      env: { url: local.url, anonKey: local.anonKey, emailDomain: DOMAIN },
      dataDir: dir,
      storage: createFileStorage(path.join(dir, "auth-session.json"), cipher),
      onSessionChanged: session => events.push(session),
    });
    return { service, events, dir };
  };

  const createUser = async (nickname: string, code: string, password: string): Promise<string> => {
    const { data, error } = await admin.auth.admin.createUser({ email: authEmail(nickname, code, DOMAIN), password, email_confirm: true });
    if (error) throw error;
    userIds.push(data.user.id);
    return data.user.id;
  };
  const seedProject = async (code: string, nickname: string, password: string) => {
    const userId = await createUser(nickname, code, password);
    const { data, error } = await admin.rpc("create_project_for", { p_user: userId, p_code: code, p_nickname: nickname });
    if (error) throw error;
    const row = (data as { project_id: string; invite_code: string }[])[0];
    projectIds.push(row.project_id);
    return { userId, projectId: row.project_id, inviteCode: row.invite_code };
  };
  const seedMember = async (inviteCode: string, code: string, nickname: string, password: string) => {
    const userId = await createUser(nickname, code, password);
    const { error } = await admin.rpc("join_project_for", { p_user: userId, p_invite: inviteCode, p_nickname: nickname });
    if (error) throw error;
    return userId;
  };

  const codeA = unique("auth-a");
  const codeB = unique("auth-b");

  try {
    const projectA = await seedProject(codeA, "owner", "owner-pass1");
    const memberAId = await seedMember(projectA.inviteCode, codeA, "member", "member-pass1");
    const projectB = await seedProject(codeB, "owner", "owner-pass2");

    const ownerA = await newService();
    const memberA = await newService();
    const ownerB = await newService();
    let inviteA = projectA.inviteCode;
    let saved: ProjectSettings | undefined;

    await t.test("sign in → session, remember, recent, restore", async () => {
      assert.equal(await ownerA.service.getSession(), null);
      await fails(ownerA.service.signIn({ projectCode: codeA, nickname: "owner", password: "wrong-pass", remember: true }), MESSAGES.badCredentials);
      const session = await ownerA.service.signIn({ projectCode: ` ${codeA.toUpperCase()} `, nickname: "Owner", password: "owner-pass1", remember: true });
      assert.deepEqual(session, { userId: projectA.userId, projectId: projectA.projectId, projectCode: codeA, nickname: "owner", role: "owner" });
      assert.deepEqual(ownerA.events.at(-1), session);
      assert.deepEqual(await ownerA.service.getRemembered(), { projectCode: codeA, nickname: "owner" });
      assert.deepEqual((await ownerA.service.listRecentProjects()).map(p => [p.projectCode, p.nickname]), [[codeA, "owner"]]);

      // 같은 저장소로 새로 켜면 로그인 없이 복원된다.
      const restarted = await newService(ownerA.dir);
      assert.deepEqual(await restarted.service.getSession(), session);
      assert.deepEqual(restarted.events, [session]);

      const member = await memberA.service.signIn({ projectCode: codeA, nickname: "member", password: "member-pass1", remember: false });
      assert.equal(member.role, "member");
      assert.equal(await memberA.service.getRemembered(), null);
      await ownerB.service.signIn({ projectCode: codeB, nickname: "owner", password: "owner-pass2", remember: false });
    });

    await t.test("project info: owner first, invite code", async () => {
      const info = await memberA.service.getProject();
      assert.equal(info.code, codeA);
      assert.equal(info.inviteCode, inviteA);
      assert.deepEqual(info.members.map(m => [m.nickname, m.role]), [["owner", "owner"], ["member", "member"]]);
      assert.equal(info.members[1].userId, memberAId);
    });

    await t.test("project settings: save, partial pairs, conflicts, deletes", async () => {
      assert.deepEqual(await ownerA.service.getProjectSettings(), { endpoints: [], environments: [], urls: [] });
      const [front, back, dev, prod] = Array.from({ length: 4 }, () => crypto.randomUUID());
      saved = await ownerA.service.saveProjectSettings({
        endpoints: [
          { id: front, name: "프론트", kind: "web", position: 0 },
          { id: back, name: "백엔드", kind: "api", position: 1 },
        ],
        environments: [
          { id: dev, name: "dev", position: 0 },
          { id: prod, name: "prod", position: 1 },
        ],
        urls: [
          { endpointId: front, environmentId: dev, baseUrl: "https://dev.app.com", specUrl: null },
          { endpointId: back, environmentId: dev, baseUrl: "https://dev-api.app.com", specUrl: "https://dev-api.app.com/docs.json" },
          { endpointId: back, environmentId: prod, baseUrl: "https://api.app.com", specUrl: null },
        ],
      });
      assert.deepEqual(saved.endpoints.map(e => e.name), ["프론트", "백엔드"]);
      assert.equal(saved.urls.length, 3);
      assert.ok([...saved.endpoints, ...saved.environments, ...saved.urls].every(row => row.updatedAt));

      // 팀원이 먼저 고치면 오래된 내용으로 저장할 때 충돌.
      const memberView = await memberA.service.getProjectSettings();
      assert.deepEqual(memberView, saved);
      await memberA.service.saveProjectSettings({
        ...memberView,
        endpoints: memberView.endpoints.map(e => (e.id === back ? { ...e, name: "백엔드2" } : e)),
      });
      await fails(
        ownerA.service.saveProjectSettings({ ...saved, urls: saved.urls.map(u => ({ ...u, baseUrl: `${u.baseUrl}/x` })) }),
        MESSAGES.conflict,
      );

      // 다시 읽고 prod 환경을 지우면 그 주소도 같이 지워진다.
      const reloaded = await ownerA.service.getProjectSettings();
      assert.equal(reloaded.endpoints.find(e => e.id === back)?.name, "백엔드2");
      const withoutProd = await ownerA.service.saveProjectSettings({
        ...reloaded,
        environments: reloaded.environments.filter(e => e.id !== prod),
        urls: reloaded.urls.filter(u => u.environmentId !== prod),
      });
      assert.deepEqual(withoutProd.environments.map(e => e.name), ["dev"]);
      assert.equal(withoutProd.urls.length, 2);
      // 바뀌지 않은 행은 updatedAt이 그대로다.
      assert.equal(withoutProd.environments[0].updatedAt, reloaded.environments[0].updatedAt);

      // 팀원은 지워진 prod를 아직 들고 있다 → 충돌.
      await fails(memberA.service.saveProjectSettings(memberView), MESSAGES.conflict);

      // 읽은 뒤 다른 팀원이 추가한 행은 모르는 행이므로 지우지 않고 충돌로 거절한다.
      const memberFresh = await memberA.service.getProjectSettings();
      const stage = crypto.randomUUID();
      await ownerA.service.saveProjectSettings({
        ...withoutProd,
        environments: [...withoutProd.environments, { id: stage, name: "stage", position: 1 }],
      });
      await fails(memberA.service.saveProjectSettings(memberFresh), MESSAGES.conflict);
      const final = await memberA.service.getProjectSettings();
      assert.deepEqual(final.environments.map(e => e.name), ["dev", "stage"]);
      saved = final;
    });

    await t.test("RLS isolation between projects", async () => {
      const infoB = await ownerB.service.getProject();
      assert.equal(infoB.code, codeB);
      assert.deepEqual(infoB.members.map(m => m.nickname), ["owner"]);
      assert.deepEqual(await ownerB.service.getProjectSettings(), { endpoints: [], environments: [], urls: [] });
      const { data: members } = await ownerB.service.client.from("members").select("user_id");
      assert.deepEqual(members, [{ user_id: projectB.userId }]);
      const { data: endpoints } = await ownerB.service.client.from("endpoints").select("id");
      assert.deepEqual(endpoints, []);
      const { data: projects } = await ownerB.service.client.from("projects").select("id");
      assert.deepEqual(projects, [{ id: projectB.projectId }]);

      // 다른 프로젝트 행은 보이지 않으므로 고칠 수 없다.
      const target = saved!.endpoints[0];
      const { data: hacked } = await ownerB.service.client.from("endpoints").update({ name: "hack" }).eq("id", target.id).select();
      assert.deepEqual(hacked, []);
      await fails(ownerB.service.saveProjectSettings({ endpoints: [target], environments: [], urls: [] }), MESSAGES.conflict);
      const stillA = await ownerA.service.getProjectSettings();
      assert.equal(stillA.endpoints[0].name, target.name);
    });

    await t.test("regenerate invite code: owner only", async () => {
      await fails(memberA.service.regenerateInviteCode(), MESSAGES.forbidden);
      const next = await ownerA.service.regenerateInviteCode();
      assert.match(next, /^[A-Z]{3}-[A-HJ-NP-Z2-9]{6}$/);
      assert.notEqual(next, inviteA);
      assert.equal((await ownerA.service.getProject()).inviteCode, next);
      inviteA = next;
    });

    await t.test("signed-out checks: invite preview, code and nickname availability", async () => {
      const anon = await newService();
      assert.equal(await anon.service.getSession(), null);
      const preview = await anon.service.previewInvite(` ${inviteA.toLowerCase()} `);
      assert.equal(preview?.projectCode, codeA);
      assert.equal(preview?.ownerNickname, "owner");
      assert.equal(preview?.memberCount, 2);
      assert.equal(await anon.service.previewInvite("ZZZ-ZZZZZZ"), null);
      assert.equal(await anon.service.previewInvite(projectA.inviteCode), null);
      assert.equal(await anon.service.isProjectCodeAvailable(codeA), false);
      assert.equal(await anon.service.isProjectCodeAvailable(unique("auth-free")), true);
      assert.equal(await anon.service.isProjectCodeAvailable("A!"), false);
      assert.equal(await anon.service.isNicknameAvailable(inviteA, "member"), false);
      assert.equal(await anon.service.isNicknameAvailable(inviteA, "newbie"), true);
      await fails(anon.service.getProject(), MESSAGES.signedOut);
    });

    await t.test("change password, sign out, sign in again", async () => {
      await fails(memberA.service.changePassword({ currentPassword: "wrong-pass", newPassword: "member-pass2" }), MESSAGES.wrongPassword);
      await fails(memberA.service.changePassword({ currentPassword: "member-pass1", newPassword: "123" }), MESSAGES.shortPassword);
      await memberA.service.changePassword({ currentPassword: "member-pass1", newPassword: "member-pass2" });
      assert.equal((await memberA.service.getProject()).code, codeA);

      await memberA.service.signOut();
      assert.equal(memberA.events.at(-1), null);
      assert.equal(await memberA.service.getSession(), null);
      await fails(memberA.service.signIn({ projectCode: codeA, nickname: "member", password: "member-pass1", remember: false }), MESSAGES.badCredentials);
      assert.equal((await memberA.service.signIn({ projectCode: codeA, nickname: "member", password: "member-pass2", remember: false })).userId, memberAId);
    });

    await t.test("edge functions: create, join, change nickname, remove member", async s => {
      if (!(await functionsServed(local))) {
        s.skip("Edge Function이 서빙되지 않아 건너뜀");
        return;
      }
      const codeC = unique("auth-c");
      const creator = await newService();
      const joiner = await newService();
      await fails(creator.service.createProject({ code: codeC, nickname: "boss", password: "123" }), MESSAGES.shortPassword);
      const created = await creator.service.createProject({ code: codeC, nickname: "boss", password: "boss-pass1" });
      projectIds.push(created.session.projectId);
      userIds.push(created.session.userId);
      assert.equal(created.session.role, "owner");
      assert.equal(created.session.projectCode, codeC);
      assert.match(created.inviteCode, /^[A-Z]{3}-[A-HJ-NP-Z2-9]{6}$/);
      assert.deepEqual(creator.events.at(-1), created.session);
      assert.equal((await creator.service.listRecentProjects())[0].projectCode, codeC);
      // 함수가 돌려준 한국어 오류를 그대로 보여준다.
      await fails(joiner.service.createProject({ code: codeC, nickname: "other", password: "other-pass1" }), /[가-힣]/);
      await assert.rejects(joiner.service.createProject({ code: codeC, nickname: "other", password: "other-pass1" }), (e: unknown) => toUserMessage(e) !== MESSAGES.unknown);

      const joined = await joiner.service.joinProject({ inviteCode: created.inviteCode, nickname: "crew", password: "crew-pass1" });
      userIds.push(joined.userId);
      assert.deepEqual([joined.projectCode, joined.nickname, joined.role], [codeC, "crew", "member"]);
      await fails(joiner.service.joinProject({ inviteCode: "ZZZ-ZZZZZZ", nickname: "crew9", password: "crew-pass1" }), /[가-힣]/);

      const renamed = await joiner.service.changeNickname("crew2");
      assert.equal(renamed.nickname, "crew2");
      assert.deepEqual(joiner.events.at(-1), renamed);
      assert.equal((await joiner.service.client.auth.getSession()).data.session?.user.email, authEmail("crew2", codeC, DOMAIN));
      assert.deepEqual((await joiner.service.listRecentProjects()).map(p => p.nickname), ["crew2"]);
      assert.deepEqual((await creator.service.getProject()).members.map(m => m.nickname), ["boss", "crew2"]);

      await fails(joiner.service.removeMember(created.session.userId), /[가-힣]/);
      await creator.service.removeMember(joined.userId);
      assert.deepEqual((await creator.service.getProject()).members.map(m => m.nickname), ["boss"]);
    });
  } finally {
    if (projectIds.length) await admin.from("projects").delete().in("id", projectIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }
});

