// 닉네임 변경: members.nickname과 로그인 이메일을 같이 바꾼다. 사용자 JWT 필요. body { nickname } → { nickname }
import { admin, dbError, isUnique, loginEmail, nickname, nicknameTaken, requireMember } from "../_shared/account.ts";
import { internalError, serve } from "../_shared/http.ts";

serve(async (body, req) => {
  const { user, member } = await requireMember(req);
  const nick = nickname(body.nickname);
  if (nick === member.nickname) return { nickname: nick };

  // 닉네임을 먼저 바꾼다. (project_id, nickname) unique가 중복·동시 변경을 막는다.
  // Auth Admin의 이메일 변경은 중복이어도 email_exists 대신 500을 주므로 이메일을 나중에 바꾼다.
  const setNickname = (value: string) => admin.from("members").update({ nickname: value }).eq("user_id", user.id);
  const { error } = await setNickname(nick);
  if (isUnique(error, "members_project_id_nickname_key")) throw nicknameTaken();
  if (error) throw dbError(error);

  const { error: emailError } = await admin.auth.admin.updateUserById(user.id, {
    email: loginEmail(nick, member.projectCode),
    email_confirm: true,
  });
  if (emailError) {
    const { error: revertError } = await setNickname(member.nickname);
    if (revertError) console.error("revert nickname", user.id, revertError);
    if (emailError.code === "email_exists") throw nicknameTaken();
    console.error("updateUserById", emailError);
    throw internalError();
  }
  return { nickname: nick };
});
