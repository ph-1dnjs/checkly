// 계정 공통: 입력 형식, 로그인 이메일, service_role 클라이언트, 호출자 확인.
// 계정 모델: auth 사용자 1명 = 프로젝트 멤버 1명 (docs/02-architecture/supabase-common.md)
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { AppError, internalError } from "./http.ts";

export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 앱(Electron main)과 같은 값을 써야 한다.
const EMAIL_DOMAIN = Deno.env.get("CHECKLY_AUTH_EMAIL_DOMAIN") || "checkly.test";

export const loginEmail = (nickname: string, projectCode: string) => `${nickname}.${projectCode}@${EMAIL_DOMAIN}`;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function projectCode(value: unknown) {
  const code = text(value);
  if (!/^[a-z0-9-]{3,32}$/.test(code)) {
    throw new AppError("invalid_input", "프로젝트 코드는 영문 소문자, 숫자, 하이픈(-)으로 3~32자여야 합니다.");
  }
  return code;
}

export function nickname(value: unknown) {
  const nick = text(value);
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(nick)) {
    throw new AppError("invalid_input", "닉네임은 영문 소문자로 시작하고 영문 소문자, 숫자, 밑줄(_)로 3~20자여야 합니다.");
  }
  return nick;
}

export function inviteCode(value: unknown) {
  const invite = text(value).toUpperCase();
  if (!/^[A-Z]{3}-[A-HJ-NP-Z2-9]{6}$/.test(invite)) throw invalidInvite();
  return invite;
}

export function password(value: unknown) {
  const pw = typeof value === "string" ? value : "";
  if (pw.length < 6) throw weakPassword();
  // bcrypt 한계. 넘으면 Auth가 거절한다.
  if (new TextEncoder().encode(pw).length > 72) throw new AppError("invalid_input", "비밀번호는 72자 이하여야 합니다.");
  return pw;
}

/**
 * 새 프로젝트 생성 코드(운영자가 발급). env CHECKLY_CREATE_PROJECT_CODE와 상수 시간으로 비교한다.
 * env가 비어 있으면 누구도 만들 수 없다. 다른 검증·사용자 생성보다 먼저 부른다.
 */
export async function requireCreateCode(value: unknown) {
  const expected = Deno.env.get("CHECKLY_CREATE_PROJECT_CODE")?.trim() ?? "";
  if (!expected) throw new AppError("create_disabled", "지금은 새 프로젝트를 만들 수 없습니다. 운영자에게 문의하세요.");
  const given = typeof value === "string" ? value.trim() : "";
  if (!(await sameSecret(given, expected))) {
    throw new AppError("invalid_create_code", "생성 코드가 올바르지 않습니다. 운영자에게 문의하세요.");
  }
}

/** 길이에 상관없이 같은 시간이 걸리도록 SHA-256으로 길이를 맞춘 뒤 모든 바이트를 비교한다. */
async function sameSecret(a: string, b: string) {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const invalidInvite = () => new AppError("invalid_invite", "유효하지 않은 초대코드입니다.");
export const nicknameTaken = () => new AppError("nickname_taken", "이 프로젝트에서 이미 쓰는 닉네임입니다.");
export const codeTaken = () => new AppError("code_taken", "이미 사용 중인 프로젝트 코드입니다.");
const weakPassword = () => new AppError("weak_password", "비밀번호는 6자 이상이어야 합니다.");

/** Postgres unique 위반이고 제약 이름이 맞는지. PostgREST 오류(code, message)를 본다. */
export const isUnique = (error: { code?: string; message?: string } | null, constraint: string) =>
  error?.code === "23505" && !!error.message?.includes(constraint);

/**
 * auth 사용자를 만들고 attach(프로젝트 생성·가입)를 실행한다. attach가 실패하면 만든 사용자를 지운다.
 * 이메일이 이미 있으면 takenAs 오류(같은 프로젝트 코드·닉네임 조합이 이미 있음).
 */
export async function withNewUser<T>(email: string, pw: string, takenAs: () => AppError, attach: (userId: string) => Promise<T>) {
  const createUser = () => admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  let { data, error } = await createUser();
  // 같은 이메일을 동시에 만들면 진 쪽은 email_exists 대신 500("Database error creating new user")을 받는다.
  // 그때는 이긴 쪽이 이미 커밋했으므로 한 번 더 시도해 정확한 오류를 받는다.
  if (error?.status === 500) ({ data, error } = await createUser());
  if (error) {
    if (error.code === "email_exists") throw takenAs();
    if (error.code === "weak_password") throw weakPassword();
    console.error("createUser", error);
    throw internalError();
  }
  try {
    return await attach(data.user.id);
  } catch (e) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
    if (deleteError) console.error("deleteUser after failed attach", data.user.id, deleteError);
    throw e;
  }
}

/** Authorization: Bearer <사용자 JWT>의 사용자와 멤버 정보. */
export async function requireMember(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const unauthorized = () => new AppError("unauthorized", "로그인이 필요합니다. 다시 로그인해 주세요.");
  if (!token) throw unauthorized();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw unauthorized();
  const member = await findMember(data.user.id);
  if (!member) throw new AppError("unauthorized", "프로젝트 멤버가 아닙니다. 다시 로그인해 주세요.");
  return { user: data.user, member };
}

export async function findMember(userId: string) {
  const { data, error } = await admin
    .from("members")
    .select("user_id, project_id, nickname, role, projects(code)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError(error);
  if (!data) return null;
  const project = data.projects as unknown as { code: string };
  return { userId: data.user_id, projectId: data.project_id, nickname: data.nickname, role: data.role, projectCode: project.code };
}

export function dbError(error: unknown) {
  console.error("db", error);
  return internalError();
}
