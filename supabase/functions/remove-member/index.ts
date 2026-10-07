// 멤버 내보내기(관리자만): auth 사용자를 지운다. members 행은 cascade. 사용자 JWT 필요. body { userId } → {}
import { admin, findMember, requireMember } from "../_shared/account.ts";
import { AppError, internalError, serve } from "../_shared/http.ts";

serve(async (body, req) => {
  const { member: caller } = await requireMember(req);
  if (caller.role !== "owner") throw new AppError("owner_only", "관리자만 멤버를 내보낼 수 있습니다.");
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new AppError("invalid_input", "내보낼 멤버가 올바르지 않습니다.");
  }

  const target = await findMember(userId);
  if (!target || target.projectId !== caller.projectId) throw new AppError("not_found", "이 프로젝트의 멤버가 아닙니다.");
  if (target.role === "owner") throw new AppError("cannot_remove_owner", "관리자는 내보낼 수 없습니다.");

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("deleteUser", userId, error);
    throw internalError();
  }
  return {};
});
