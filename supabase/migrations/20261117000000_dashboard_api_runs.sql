-- Codex 2026-11-17: 대시보드용 API 시나리오 실행 요약을 팀 프로젝트에 저장한다.
create table if not exists public.api_scenario_runs (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  environment_id uuid,
  scenario_id text not null,
  scenario_name text not null,
  status text not null check (status in ('passed', 'failed', 'blocked', 'cancelled')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (ended_at >= started_at)
);
create index if not exists api_scenario_runs_project_started_idx on public.api_scenario_runs(project_id, started_at desc, id);
alter table public.api_scenario_runs enable row level security;
drop policy if exists "같은 프로젝트" on public.api_scenario_runs;
create policy "같은 프로젝트" on public.api_scenario_runs for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
drop trigger if exists touch on public.api_scenario_runs;
create trigger touch before insert or update on public.api_scenario_runs for each row execute function public.touch();
grant select, insert, update, delete on public.api_scenario_runs to authenticated;
