import type { AuthBridge, AuthSession } from "../../shared/model/electron-api/auth";

/** 로그인한 상태에서 설정 화면이 쓰는 계정 동작. useAuth가 만든다. */
export type AuthAccount = {
  bridge: AuthBridge;
  session: AuthSession;
  signOut: () => Promise<void>;
  /** 다른 프로젝트 계정으로 로그인한 뒤 앱을 다시 불러온다. */
  switchProject: (input: { projectCode: string; nickname: string; password: string }) => Promise<void>;
  /** 초대코드 가입 화면을 앱 위에 띄운다. */
  openJoin: () => void;
  updateSession: (session: AuthSession) => void;
};

export type AuthMode = "login" | "join" | "create";

export const PASSWORD_MIN = 6;
export const PROJECT_CODE_PATTERN = /^[a-z0-9-]{3,32}$/;
export const NICKNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;
export const INVITE_PATTERN = /^[A-Z]{3}-[A-Z0-9]{6}$/;
export const PROJECT_CODE_HINT = "영문 소문자·숫자·하이픈 3–32자";
export const NICKNAME_HINT = "영문 소문자로 시작 · 영문·숫자·_ 3–20자";
export const INVALID_INVITE = "유효하지 않은 초대코드입니다.";

/** 입력 중: 공백 제거 + 대문자. */
export const normalizeInvite = (value: string): string => value.replace(/\s+/g, "").toUpperCase();
/** 제출 시: 하이픈 없이 9자를 넣었으면 3자 뒤에 하이픈을 넣는다. */
export const completeInvite = (value: string): string => {
  const code = normalizeInvite(value);
  return /^[A-Z0-9]{9}$/.test(code) ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
};

export const passwordError = (password: string, confirm: string): string => {
  if (password.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
  if (password !== confirm) return "비밀번호가 일치하지 않습니다.";
  return "";
};

export const formatDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
};

export const roleLabel = (role: AuthSession["role"]): string => (role === "owner" ? "관리자" : "팀원");

/** bridge 거절 메시지는 그대로 보여준다. Electron이 앞에 붙이는 호출 정보만 걷어낸다. */
export const errorMessage = (error: unknown, fallback = "요청을 처리하지 못했습니다."): string => {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^(Error:\s*)+/, "").trim();
  return message || fallback;
};

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
};

export type CheckTone = "hint" | "warn" | "fail" | "pass";
export type FieldCheck = { text: string; tone: CheckTone; ok: boolean };
export type Availability = "checking" | "available" | "taken" | "error" | null;

/** 프로젝트 코드·닉네임 입력 아래 한 줄 안내. availability는 서버 확인 결과. */
export const fieldCheck = (
  value: string,
  pattern: RegExp,
  hint: string,
  availability: Availability,
  messages: { taken: string; available: string },
): FieldCheck => {
  if (!value) return { text: hint, tone: "hint", ok: false };
  if (!pattern.test(value)) return { text: hint, tone: "warn", ok: false };
  if (availability === "taken") return { text: messages.taken, tone: "fail", ok: false };
  if (availability === "available") return { text: messages.available, tone: "pass", ok: true };
  if (availability === "checking") return { text: "확인 중…", tone: "hint", ok: true };
  // 확인 요청이 실패하면 서버가 가입 시 다시 검사하므로 막지 않는다.
  return { text: hint, tone: "hint", ok: true };
};
