// 비밀번호 재설정 코드 발급(관리자만): 같은 프로젝트 멤버의 코드를 새로 만든다. 사용자 JWT 필요.
// body { userId } → { code, expiresAt }. 이전 코드는 바로 쓸 수 없게 된다.
import { admin, dbError, findMember, requireMember } from "../_shared/account.ts";
import { AppError, serve } from "../_shared/http.ts";
import { hashResetCode, newResetCode, RESET_TTL_MS } from "../_shared/reset.ts";

serve(async (body, req) => {
  const { member: caller } = await requireMember(req);
  if (caller.role !== "owner") throw new AppError("owner_only", "관리자만 재설정 코드를 발급할 수 있습니다.");
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new AppError("invalid_input", "코드를 발급할 멤버가 올바르지 않습니다.");
  }

  const target = await findMember(userId);
  if (!target || target.projectId !== caller.projectId) throw new AppError("not_found", "이 프로젝트의 멤버가 아닙니다.");
  // 관리자 본인은 로그인한 상태에서 설정 > 계정의 비밀번호 변경을 쓴다.
  if (target.role === "owner") throw new AppError("invalid_input", "관리자 비밀번호는 설정 > 계정에서 변경합니다.");

  const code = newResetCode();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
  const { error } = await admin.from("auth_password_resets").upsert({
    user_id: userId,
    project_id: caller.projectId,
    code_hash: await hashResetCode(userId, code),
    attempts: 0,
    expires_at: expiresAt,
    created_by: caller.userId,
    created_at: new Date().toISOString(),
  });
  if (error) throw dbError(error);
  return { code, expiresAt };
});
