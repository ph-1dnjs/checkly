// 사용자에게 보여줄 한국어 오류. IPC로는 throw 대신 결과값으로 보낸다(Electron이 붙이는
// "Error invoking remote method…" 접두어를 피하려고). bridge.ts가 받아서 Error로 다시 던진다.

export type AuthResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const MESSAGES = {
  disabled: "팀 프로젝트 서버가 설정되지 않았습니다.",
  badCredentials: "프로젝트 코드, 닉네임 또는 비밀번호가 올바르지 않습니다.",
  network: "서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.",
  forbidden: "권한이 없습니다.",
  signedOut: "로그인이 필요합니다.",
  expired: "로그인이 만료되었습니다. 다시 로그인하세요.",
  removed: "프로젝트에서 내보내져 로그아웃되었습니다. 다시 참여하려면 관리자에게 초대코드를 받아 새로 가입하세요.",
  conflict: "다른 팀원이 먼저 수정했습니다. 새로 불러온 뒤 다시 저장하세요.",
  wrongPassword: "현재 비밀번호가 올바르지 않습니다.",
  shortPassword: "비밀번호는 6자 이상이어야 합니다.",
  samePassword: "새 비밀번호가 현재 비밀번호와 같습니다.",
  rateLimited: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  duplicateName: "같은 이름이 이미 있습니다.",
  invalidCreateCode: "생성 코드가 올바르지 않습니다. 운영자에게 문의하세요.",
  createDisabled: "지금은 새 프로젝트를 만들 수 없습니다. 운영자에게 문의하세요.",
  unknown: "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.",
} as const;

/** message를 그대로 사용자에게 보여주는 오류. */
export class AuthFailure extends Error {}

type ErrorLike = { name?: string; message?: string; code?: string; status?: number };

const NETWORK = /fetch failed|failed to fetch|fetcherror|econnrefused|enotfound|etimedout|econnreset|network/i;

/** 알 수 없는 오류는 원문을 main 로그에 남기고 일반 문장으로 바꾼다. */
export const toUserMessage = (error: unknown): string => {
  if (error instanceof AuthFailure) return error.message;
  const e = (error ?? {}) as ErrorLike;
  const code = e.code ?? "";
  const message = e.message ?? String(error);
  if (code === "invalid_credentials") return MESSAGES.badCredentials;
  if (code === "weak_password") return MESSAGES.shortPassword;
  if (code === "same_password") return MESSAGES.samePassword;
  if (e.status === 429 || code.startsWith("over_")) return MESSAGES.rateLimited;
  if (e.name === "AuthSessionMissingError") return MESSAGES.signedOut;
  if (code === "PGRST301" || code === "PGRST303" || code === "session_not_found" || code === "bad_jwt") return MESSAGES.expired;
  if (e.name === "AuthRetryableFetchError" || e.name === "FunctionsFetchError" || NETWORK.test(message)) return MESSAGES.network;
  // PGRST116: 하나를 읽으려 했는데 보이는 행이 없음(RLS로 가려짐).
  if (code === "42501" || code === "PGRST116" || /row-level security|permission denied/i.test(message)) return MESSAGES.forbidden;
  if (message === "settings_conflict") return MESSAGES.conflict;
  if (code === "23505") return MESSAGES.duplicateName;
  console.error("[auth]", error);
  return MESSAGES.unknown;
};
