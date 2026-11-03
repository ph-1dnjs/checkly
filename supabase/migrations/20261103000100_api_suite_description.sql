-- 스위트 실행 전 준비 사항과 참고 정보를 공유한다.
alter table public.api_suites
  add column if not exists description text
  check (description is null or char_length(description) <= 5000);
