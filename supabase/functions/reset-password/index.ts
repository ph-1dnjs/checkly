// 비밀번호 찾기(로그인 전 호출): 관리자가 발급한 재설정 코드로 새 비밀번호를 정한다.
// body { step, projectCode, nickname, code?, password? }
//   step "lookup" → { projectCode, nickname, ownerNickname }   계정 확인(1단계)
//   step "verify" → {}                                         코드 확인(2단계), 코드를 쓰지 않는다
//   step "reset"  → {}                                         코드 확인 후 비밀번호 변경, 코드를 지운다
import { admin, dbError, nickname, password, projectCode } from "../_shared/account.ts";
import { AppError, internalError, serve } from "../_shared/http.ts";
import { hashResetCode, invalidResetCode, RESET_MAX_ATTEMPTS, resetCode } from "../_shared/reset.ts";

const notFound = () => new AppError("not_found", "프로젝트 코드 또는 닉네임이 올바르지 않습니다.");

async function findAccount(code: string, nick: string) {
  const { data: project, error } = await admin.from("projects").select("id, code").eq("code", code).maybeSingle();
  if (error) throw dbError(error);
  if (!project) throw notFound();
  const { data: rows, error: membersError } = await admin
    .from("members")
    .select("user_id, nickname, role")
    .eq("project_id", project.id);
  if (membersError) throw dbError(membersError);
  const member = rows?.find((row) => row.nickname === nick);
  if (!member) throw notFound();
  // 관리자 비밀번호를 대신 정해 줄 사람이 없다.
  if (member.role === "owner") throw new AppError("invalid_input", "관리자 계정은 재설정 코드를 받을 수 없습니다. 운영자에게 문의하세요.");
  const owner = rows?.find((row) => row.role === "owner");
  return { userId: member.user_id as string, projectCode: project.code as string, ownerNickname: (owner?.nickname as string) ?? "-" };
}

/** 코드가 맞으면 통과. 틀리면 시도 횟수를 늘리고, 다 쓰거나 만료됐으면 코드를 지운다. */
async function checkCode(userId: string, code: string) {
  const { data: row, error } = await admin
    .from("auth_password_resets")
    .select("code_hash, attempts, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError(error);
  if (!row) throw invalidResetCode();
  const drop = () => admin.from("auth_password_resets").delete().eq("user_id", userId);
  if (new Date(row.expires_at).getTime() <= Date.now() || row.attempts >= RESET_MAX_ATTEMPTS) {
    await drop();
    throw invalidResetCode();
  }
  if ((await hashResetCode(userId, code)) === row.code_hash) return;
  // 읽은 attempts를 조건으로 올려 동시에 틀린 요청이 횟수를 덮어쓰지 않게 한다.
  const next = row.attempts + 1;
  const { error: updateError } = await admin
    .from("auth_password_resets")
    .update({ attempts: next })
    .eq("user_id", userId)
    .eq("attempts", row.attempts);
  if (updateError) throw dbError(updateError);
  if (next >= RESET_MAX_ATTEMPTS) await drop();
  throw invalidResetCode();
}

serve(async (body) => {
  const step = body.step;
  if (step !== "lookup" && step !== "verify" && step !== "reset") throw new AppError("invalid_input", "요청 형식이 올바르지 않습니다.");
  const nick = nickname(body.nickname);
  const account = await findAccount(projectCode(body.projectCode), nick);
  if (step === "lookup") return { projectCode: account.projectCode, nickname: nick, ownerNickname: account.ownerNickname };

  const code = resetCode(body.code);
  // 비밀번호 형식을 먼저 확인해 형식 오류로 코드 시도 횟수를 쓰지 않게 한다.
  const pw = step === "reset" ? password(body.password) : "";
  await checkCode(account.userId, code);
  if (step === "verify") return {};

  const { error } = await admin.auth.admin.updateUserById(account.userId, { password: pw });
  if (error) {
    console.error("updateUserById password", account.userId, error);
    throw internalError();
  }
  const { error: deleteError } = await admin.from("auth_password_resets").delete().eq("user_id", account.userId);
  if (deleteError) console.error("delete reset code", account.userId, deleteError);
  return {};
});
