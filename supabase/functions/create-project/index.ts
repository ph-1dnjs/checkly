// 새 프로젝트: auth 사용자(관리자) 생성 → create_project_for. body { code, nickname, password } → { projectId, inviteCode }
import { admin, codeTaken, dbError, isUnique, loginEmail, nickname, password, projectCode, withNewUser } from "../_shared/account.ts";
import { serve } from "../_shared/http.ts";

serve(async (body) => {
  const code = projectCode(body.code);
  const nick = nickname(body.nickname);
  const pw = password(body.password);

  const { data: existing, error } = await admin.from("projects").select("id").eq("code", code).maybeSingle();
  if (error) throw dbError(error);
  if (existing) throw codeTaken();

  return await withNewUser(loginEmail(nick, code), pw, codeTaken, async (userId) => {
    const { data, error } = await admin.rpc("create_project_for", { p_user: userId, p_code: code, p_nickname: nick }).single();
    // 확인과 생성 사이에 같은 코드가 먼저 만들어진 경우
    if (isUnique(error, "projects_code_key")) throw codeTaken();
    if (error || !data) throw dbError(error);
    const row = data as { project_id: string; invite_code: string };
    return { projectId: row.project_id, inviteCode: row.invite_code };
  });
});
