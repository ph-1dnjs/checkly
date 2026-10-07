// 응답 형식: 성공은 200 + 본문, 실패는 4xx/5xx + { error: { code, message } }.
// message는 앱이 사용자에게 그대로 보여주는 한국어 문장이다.

export type ErrorCode =
  | "invalid_input"
  | "code_taken"
  | "invalid_invite"
  | "nickname_taken"
  | "weak_password"
  | "unauthorized"
  | "owner_only"
  | "cannot_remove_owner"
  | "not_found"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  code_taken: 409,
  invalid_invite: 404,
  nickname_taken: 409,
  weak_password: 400,
  unauthorized: 401,
  owner_only: 403,
  cannot_remove_owner: 403,
  not_found: 404,
  internal: 500,
};

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
}

export const internalError = () => new AppError("internal", "서버에서 오류가 났습니다. 잠시 후 다시 시도해 주세요.");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

/** POST JSON 본문을 받아 handler 결과를 200으로, AppError는 정해진 상태 코드로 돌려준다. */
export function serve(handler: (body: Record<string, unknown>, req: Request) => Promise<unknown>) {
  Deno.serve(async (req) => {
    try {
      if (req.method !== "POST") throw new AppError("invalid_input", "POST로 호출해야 합니다.");
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new AppError("invalid_input", "요청 형식이 올바르지 않습니다.");
      }
      return json(200, await handler(body as Record<string, unknown>, req));
    } catch (e) {
      const err = e instanceof AppError ? e : (console.error(e), internalError());
      return json(STATUS[err.code], { error: { code: err.code, message: err.message } });
    }
  });
}
