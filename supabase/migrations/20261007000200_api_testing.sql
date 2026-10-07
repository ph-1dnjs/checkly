-- API 테스트: 시나리오 · 묶음 · 개별 요청 입력값 (팀 공유)
-- 설명: docs/02-architecture/supabase-common.md, docs/04-pages/070-api-testing/01-overview.md
--
-- 서버·환경·주소·명세 주소는 공통 테이블(endpoints kind = 'api', environments, endpoint_urls)을 쓴다.
-- 명세 본문(카탈로그), 문서 계정, 전역변수·쿠키, AI 파일은 각자 로컬에 둔다.
--
-- id는 앱이 정한 값(시나리오 YAML의 id, 묶음 id)을 그대로 쓴다. 같은 공유 파일을 두 프로젝트에
-- 가져오면 id가 같을 수 있으므로 (project_id, id)를 기본키로 둔다.

create table public.api_scenarios (
  project_id  uuid not null references public.projects(id) on delete cascade,
  id          text not null check (char_length(id) between 1 and 1000),
  name        text not null check (char_length(name) between 1 and 1000),
  -- 정규화한 시나리오 YAML. 서버는 이름(endpoints.name)으로 적는다.
  source      text not null check (octet_length(source) <= 1000000),
  draft       boolean not null default false,
  group_path  text[],
  tags        text[],
  -- 바꾸지 않기로 한 API 제목 변경 [{ from, to }]. 이것만 바꿀 때는 updated_at을 올리지 않는다(아래 트리거).
  kept_titles jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (project_id, id)
);

create table public.api_suites (
  project_id   uuid not null references public.projects(id) on delete cascade,
  id           uuid not null,
  name         text not null check (char_length(btrim(name)) between 1 and 100),
  -- api_scenarios.id 순서대로. 같은 시나리오를 여러 번 넣을 수 있다.
  scenario_ids text[] not null check (cardinality(scenario_ids) between 1 and 100),
  on_failure   text not null check (on_failure in ('stop', 'continue')),
  group_path   text[],
  tags         text[],
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  primary key (project_id, id)
);

-- API 문서 Try it out에 마지막으로 넣은 값(민감한 이름의 값은 앱이 빼고 보낸다). 서버(엔드포인트)를 지우면 같이 지운다.
create table public.api_doc_inputs (
  project_id  uuid not null references public.projects(id) on delete cascade,
  endpoint_id uuid not null,
  -- "METHOD /path"
  operation   text not null check (char_length(operation) between 1 and 2000),
  input       jsonb not null check (octet_length(input::text) <= 1000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (endpoint_id, operation),
  foreign key (endpoint_id, project_id) references public.endpoints (id, project_id) on delete cascade
);
create index api_doc_inputs_project on public.api_doc_inputs (project_id);

-- 동시 수정: 읽은 updated_at을 조건으로 갱신하고 0행이면 충돌로 본다(공통 규칙과 같다).
create trigger touch before insert or update of id, name, source, draft, group_path, tags
  on public.api_scenarios for each row execute function public.touch();
create trigger touch before insert or update on public.api_suites     for each row execute function public.touch();
create trigger touch before insert or update on public.api_doc_inputs for each row execute function public.touch();

alter table public.api_scenarios  enable row level security;
alter table public.api_suites     enable row level security;
alter table public.api_doc_inputs enable row level security;

create policy "같은 프로젝트" on public.api_scenarios for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
create policy "같은 프로젝트" on public.api_suites for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
create policy "같은 프로젝트" on public.api_doc_inputs for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
