import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 로컬 Edge Function이 쓰는 새 프로젝트 생성 코드. env CHECKLY_CREATE_PROJECT_CODE가 있으면 그것,
 * 없으면 supabase/functions/.env(gitignore, `supabase functions serve`가 읽는 파일)에서 읽는다.
 */
export function localCreateCode(root = path.resolve(__dirname, "../..")): string {
  if (process.env.CHECKLY_CREATE_PROJECT_CODE?.trim()) return process.env.CHECKLY_CREATE_PROJECT_CODE.trim();
  try {
    const text = readFileSync(path.join(root, "supabase/functions/.env"), "utf8");
    return text.match(/^\s*CHECKLY_CREATE_PROJECT_CODE\s*=\s*"?([^"\n]*?)"?\s*$/m)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}
