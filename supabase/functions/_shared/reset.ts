// 비밀번호 재설정 코드 공통: 관리자가 발급(issue-reset-code)하고 본인이 입력(reset-password)한다.
// 테이블: auth_password_resets (supabase/migrations/20261020000000_auth_password_resets.sql)
import { AppError } from "./http.ts";

/** 발급 후 유효 시간. */
export const RESET_TTL_MS = 30 * 60 * 1000;
/** 한 코드로 틀릴 수 있는 횟수. 넘으면 코드를 지우고 새로 받게 한다. */
export const RESET_MAX_ATTEMPTS = 5;

export const invalidResetCode = () =>
  new AppError("invalid_reset_code", "재설정 코드가 올바르지 않거나 만료되었습니다. 관리자에게 새 코드를 받아 주세요.");

export function resetCode(value: unknown) {
  const code = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(code)) throw new AppError("invalid_input", "재설정 코드는 6자리 숫자입니다.");
  return code;
}

/** 0–999999를 고르게 뽑아 6자리로 맞춘다. */
export function newResetCode() {
  const buf = new Uint32Array(1);
  let n: number;
  // 2^32를 1,000,000으로 나눈 나머지 쏠림을 없앤다.
  do crypto.getRandomValues(buf), (n = buf[0]);
  while (n >= 4_294_000_000);
  return String(n % 1_000_000).padStart(6, "0");
}

/** 같은 코드라도 멤버마다 다른 값이 되도록 user_id를 섞어 해시한다. */
export async function hashResetCode(userId: string, code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
