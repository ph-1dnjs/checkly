-- API 테스트: "비밀값도 팀에 공유" 설정 · 문서(스웨거) 계정 공유
-- 설명: docs/02-architecture/supabase-common.md, docs/04-pages/070-api-testing/01-overview.md
--
-- api_settings      프로젝트별 API 테스트 설정. 지금은 "비밀값도 팀에 공유"(기본 켬) 하나.
--                   켜져 있으면 개별 요청 입력값(api_doc_inputs)의 토큰·비밀번호 같은 값도 그대로 저장한다.
-- api_spec_accounts 명세 주소의 Basic 인증 계정. 위 설정이 켜져 있을 때만 저장할 수 있다(꺼져 있으면 각 PC 키체인).

create table public.api_settings (
  project_id    uuid primary key references public.projects(id) on delete cascade,
  -- 켜면 비밀값을 팀 DB에 평문으로 저장한다(개발용 계정 전제). 끄면 앱이 이미 저장된 비밀값을 지운다.
  share_secrets boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);

create table public.api_spec_accounts (
  project_id     uuid not null references public.projects(id) on delete cascade,
  endpoint_id    uuid not null,
  environment_id uuid not null,
  -- 저장 당시의 명세 주소. 다른 주소에는 이 계정을 쓰지 않는다.
  spec_url       text not null check (spec_url ~ '^https?://'),
  username       text not null check (char_length(username) between 1 and 1000 and strpos(username, ':') = 0),
  password       text not null check (char_length(password) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  primary key (endpoint_id, environment_id),
  foreign key (endpoint_id, project_id) references public.endpoints (id, project_id) on delete cascade,
  foreign key (environment_id, project_id) references public.environments (id, project_id) on delete cascade
);
create index api_spec_accounts_project on public.api_spec_accounts (project_id);

create trigger touch before insert or update on public.api_settings      for each row execute function public.touch();
create trigger touch before insert or update on public.api_spec_accounts for each row execute function public.touch();

alter table public.api_settings      enable row level security;
alter table public.api_spec_accounts enable row level security;

-- 관리자 1명이 병목이 되지 않도록 멤버 누구나 바꾼다. updated_by로 누가 바꿨는지 남는다.
create policy "같은 프로젝트" on public.api_settings for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());

-- 행이 없으면 기본값(켬).
create function public.api_shares_secrets() returns boolean
language sql stable security invoker set search_path = '' as $$
  select coalesce((select share_secrets from public.api_settings where project_id = public.my_project_id()), true)
$$;
revoke execute on function public.api_shares_secrets() from public, anon;
grant execute on function public.api_shares_secrets() to authenticated;

-- 계정은 읽기·지우기는 늘, 저장은 공유가 켜져 있을 때만(꺼진 뒤 다른 PC가 올리는 것도 막는다).
create policy "같은 프로젝트 읽기" on public.api_spec_accounts for select to authenticated
  using (project_id = public.my_project_id());
create policy "같은 프로젝트 지우기" on public.api_spec_accounts for delete to authenticated
  using (project_id = public.my_project_id());
create policy "공유가 켜져 있을 때 추가" on public.api_spec_accounts for insert to authenticated
  with check (project_id = public.my_project_id() and public.api_shares_secrets());
create policy "공유가 켜져 있을 때 수정" on public.api_spec_accounts for update to authenticated
  using (project_id = public.my_project_id())
  with check (project_id = public.my_project_id() and public.api_shares_secrets());
