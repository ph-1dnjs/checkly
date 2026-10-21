-- ph-1dnjs 2026-10-20: 비밀번호 찾기 — 관리자가 발급하는 재설정 코드 테이블 추가(가상 이메일이라 메일 재설정이 없다)
-- 멤버 1명당 유효한 코드 1개. 코드 원문은 저장하지 않고 SHA-256(user_id:code)만 둔다.
-- 읽기·쓰기는 Edge Function(issue-reset-code, reset-password)이 service_role로만 한다.

create table if not exists public.auth_password_resets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  code_hash  text not null,
  attempts   int  not null default 0,
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists auth_password_resets_project_id_idx on public.auth_password_resets (project_id);

-- 정책을 두지 않는다: anon·authenticated는 이 테이블을 읽거나 쓸 수 없다.
alter table public.auth_password_resets enable row level security;
