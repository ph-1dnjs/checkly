import type { AuthEnv } from "./service";

// 배포용 앱(패키징된 앱)이 접속하는 팀 Supabase. anon 키는 공개용이다: 앱 안에 그대로 들어가고
// 데이터는 RLS가 보호한다. service_role·secret 키와 DB 비밀번호는 절대 여기에 넣지 않는다.
// 개발 실행(npm run dev)은 이 값을 쓰지 않고 .env를 따른다 — docs/02-architecture/supabase-common.md
export const RELEASE_SUPABASE: AuthEnv = {
  url: "https://aphxwkthjgoyrfnoljjh.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHh3a3RoamdveXJmbm9sampoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NTMwODUsImV4cCI6MjEwNzEyOTA4NX0.XA60uJNOvN10ymyEnNToWiFTigqgrAI5JlSPS_gZPnw",
  emailDomain: "checkly.test",
};
