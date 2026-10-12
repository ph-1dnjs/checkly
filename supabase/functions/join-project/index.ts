// 초대코드 가입: auth 사용자 생성 → join_project_for. body { inviteCode, nickname, password } → { projectId, projectCode }
import { admin, dbError, inviteCode, invalidInvite, isUnique, loginEmail, nickname, nicknameTaken, password, withNewUser } from "../_shared/account.ts";
import { serve } from "../_shared/http.ts";

serve(async (body) => {
  const invite = inviteCode(body.inviteCode);
  const nick = nickname(body.nickname);
  const pw = password(body.password);

  const { data: project, error } = await admin.from("projects").select("id, code").eq("invite_code", invite).maybeSingle();
  if (error) throw dbError(error);
  if (!project) throw invalidInvite();
  const { count, error: countError } = await admin
    .from("members")
    .select("user_id", { count: "exact", head: true })
    .eq("project_id", project.id)
    .eq("nickname", nick);
  if (countError) throw dbError(countError);
  if (count) throw nicknameTaken();

  return await withNewUser(loginEmail(nick, project.code), pw, nicknameTaken, async (userId) => {
    const { data, error } = await admin.rpc("join_project_for", { p_user: userId, p_invite: invite, p_nickname: nick });
    // 확인과 가입 사이에 초대코드가 재발급됐거나 같은 닉네임이 먼저 가입한 경우
    if (error?.code === "P0002") throw invalidInvite();
    if (isUnique(error, "members_project_id_nickname_key")) throw nicknameTaken();
    if (error || !data) throw dbError(error);
    return { projectId: data as string, projectCode: project.code };
  });
});
