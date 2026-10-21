-- Codex 2026-10-13: 웹 시나리오 본문·마커의 DB 전용 CRUD 추가 (클라우드 적용 여부는 작업 결과 참고).
create table if not exists public.web_scenarios (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  markdown text not null,
  positions jsonb not null default '{}'::jsonb check (jsonb_typeof(positions) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists web_scenarios_project_id_idx on public.web_scenarios(project_id);
create or replace function public.web_scenario_authorship() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
drop trigger if exists authorship on public.web_scenarios;
create trigger authorship before insert or update on public.web_scenarios
for each row execute function public.web_scenario_authorship();
drop trigger if exists touch on public.web_scenarios;
create trigger touch before insert or update on public.web_scenarios
for each row execute function public.touch();
alter table public.web_scenarios enable row level security;
drop policy if exists "같은 프로젝트" on public.web_scenarios;
create policy "같은 프로젝트" on public.web_scenarios for all to authenticated
using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
grant select, insert, update, delete on public.web_scenarios to authenticated;
