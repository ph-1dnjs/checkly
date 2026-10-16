-- Codex 2026-10-14: 문서별 시나리오·단계 정규화, 소프트 삭제, 실행 스냅샷·단계 결과 저장.
-- 선행 조건: 20261013000000_web_scenarios.sql 적용 완료.
-- SQL Editor에서 수동 적용할 때도 선행 파일 전체를 먼저 실행한 뒤 이 파일 전체를 실행한다.
alter table public.web_scenarios add column if not exists deleted_at timestamptz;
create unique index if not exists web_scenarios_project_document_key on public.web_scenarios(project_id, id);

create table if not exists public.web_scenario_items (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null,
  code text not null,
  title text not null,
  base_url text not null,
  tag text,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  unique(project_id, id),
  foreign key(project_id, document_id) references public.web_scenarios(project_id, id) on delete cascade
);
create table if not exists public.web_scenario_steps (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  scenario_id uuid not null,
  code text not null,
  step_no integer not null check (step_no > 0),
  action text not null check (action in ('goto','fill','fileUpload','click','select','expectText','manualFill','manualControl','manualResult')),
  target text not null,
  value text,
  occurrence integer check (occurrence > 0),
  condition text,
  wait_seconds numeric check (wait_seconds >= 0),
  prompt text,
  marker_x numeric(4,1) check (marker_x between 0 and 100),
  marker_y numeric(4,1) check (marker_y between 0 and 100),
  marker_viewport text check (marker_viewport in ('mobile','tablet','desktop')),
  marker_page_url text,
  marker_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  foreign key(project_id, scenario_id) references public.web_scenario_items(project_id, id) on delete cascade,
  unique(scenario_id, step_no) deferrable initially deferred,
  check ((marker_x is null and marker_y is null) or (marker_x is not null and marker_y is not null and marker_viewport is not null))
);
create table if not exists public.web_runs (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  trigger text not null check (trigger in ('editor','picker','rerun','single')),
  status text not null check (status in ('passed','failed','cancelled')),
  total integer not null check (total >= 0),
  passed integer not null check (passed >= 0),
  failed integer not null check (failed >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  session_kept boolean not null,
  viewport jsonb not null,
  browser text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique(project_id, id),
  check(passed + failed <= total)
);
create table if not exists public.web_run_scenario_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null,
  scenario_id uuid,
  scenario_snapshot jsonb not null check (jsonb_typeof(scenario_snapshot) = 'object'),
  sort_order integer not null,
  status text not null check (status in ('passed','failed','cancelled')),
  failed_step_no integer,
  message text,
  started_at timestamptz,
  elapsed_seconds numeric,
  log jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique(project_id, id),
  unique(run_id, sort_order),
  foreign key(project_id, run_id) references public.web_runs(project_id, id) on delete cascade,
  foreign key(project_id, scenario_id) references public.web_scenario_items(project_id, id)
);
create table if not exists public.web_run_step_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  result_id uuid not null,
  step_no integer not null check (step_no > 0),
  status text not null check (status in ('passed','failed','skipped','not_run')),
  elapsed_ms integer not null check (elapsed_ms >= 0),
  error_message text,
  manual_verdict text check (manual_verdict in ('passed','failed')),
  manual_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique(result_id, step_no),
  foreign key(project_id, result_id) references public.web_run_scenario_results(project_id, id) on delete cascade
);
create index if not exists web_scenario_items_document_idx on public.web_scenario_items(project_id, document_id, sort_order);
create index if not exists web_scenario_steps_scenario_idx on public.web_scenario_steps(project_id, scenario_id, step_no);
create index if not exists web_runs_project_started_idx on public.web_runs(project_id, started_at desc);
create index if not exists web_run_results_run_idx on public.web_run_scenario_results(project_id, run_id);
create index if not exists web_run_steps_result_idx on public.web_run_step_results(project_id, result_id);

do $$
declare t text;
begin
  foreach t in array array['web_scenario_items','web_scenario_steps','web_runs','web_run_scenario_results','web_run_step_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "같은 프로젝트" on public.%I', t);
    execute format('create policy "같은 프로젝트" on public.%I for all to authenticated using (project_id = public.my_project_id()) with check (project_id = public.my_project_id())', t);
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch()', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 본문·ID·단계·마커를 한 트랜잭션에서 저장하며 문서 버전으로 동시 수정을 차단한다.
create or replace function public.save_web_scenario_document(p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  project uuid := public.my_project_id();
  doc public.web_scenarios;
  s jsonb; st jsonb; scenario_uuid uuid; step_number integer;
begin
  if project is null then raise exception 'signed_out'; end if;
  if p->>'id' is null then
    insert into public.web_scenarios(project_id,title,markdown,positions)
    values(project,p->>'title',p->>'markdown',p->'positions') returning * into doc;
  else
    update public.web_scenarios set title=p->>'title', markdown=p->>'markdown', positions=p->'positions'
    where project_id=project and id=(p->>'id')::uuid and updated_at=(p->>'expectedUpdatedAt')::timestamptz and deleted_at is null returning * into doc;
    if not found then raise exception 'conflict'; end if;
  end if;
  update public.web_scenario_items set deleted_at=now() where project_id=project and document_id=doc.id and deleted_at is null;
  for s in select value from jsonb_array_elements(p->'scenarios') loop
    scenario_uuid := (s->>'id')::uuid;
    if exists(select 1 from public.web_scenario_items where id=scenario_uuid and document_id<>doc.id) then raise exception 'invalid_scenario_id'; end if;
    insert into public.web_scenario_items(id,project_id,document_id,code,title,base_url,tag,sort_order)
    values(scenario_uuid,project,doc.id,s->>'code',s->>'title',s->>'url',s->>'tag',(s->>'sortOrder')::integer)
    on conflict(id) do update set code=excluded.code,title=excluded.title,base_url=excluded.base_url,tag=excluded.tag,sort_order=excluded.sort_order,deleted_at=null;
    delete from public.web_scenario_steps where project_id=project and scenario_id=scenario_uuid and id not in
      (select (value->>'databaseId')::uuid from jsonb_array_elements(s->'steps'));
    step_number := 0;
    for st in select value from jsonb_array_elements(s->'steps') loop
      step_number := step_number + 1;
      if exists(select 1 from public.web_scenario_steps where id=(st->>'databaseId')::uuid and scenario_id<>scenario_uuid) then raise exception 'invalid_step_id'; end if;
      insert into public.web_scenario_steps(id,project_id,scenario_id,code,step_no,action,target,value,occurrence,condition,wait_seconds,prompt,marker_x,marker_y,marker_viewport,marker_page_url,marker_color)
      values((st->>'databaseId')::uuid,project,scenario_uuid,(s->>'code')||'-'||step_number,step_number,st->>'action',st->>'target',st->>'value',(st->>'occurrence')::integer,st->>'condition',(st->>'waitSeconds')::numeric,st->>'prompt',(st->>'x')::numeric,(st->>'y')::numeric,st->>'markerViewport',st->>'markerPageUrl',st->>'color')
      on conflict(id) do update set code=excluded.code,step_no=excluded.step_no,action=excluded.action,target=excluded.target,value=excluded.value,occurrence=excluded.occurrence,condition=excluded.condition,wait_seconds=excluded.wait_seconds,prompt=excluded.prompt,marker_x=excluded.marker_x,marker_y=excluded.marker_y,marker_viewport=excluded.marker_viewport,marker_page_url=excluded.marker_page_url,marker_color=excluded.marker_color;
    end loop;
  end loop;
  return to_jsonb(doc);
end $$;

create or replace function public.delete_web_scenario_document(p_id uuid, p_version timestamptz) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.web_scenarios set deleted_at=now() where project_id=public.my_project_id() and id=p_id and updated_at=p_version and deleted_at is null;
  if not found then raise exception 'conflict'; end if;
  update public.web_scenario_items set deleted_at=now() where project_id=public.my_project_id() and document_id=p_id and deleted_at is null;
end $$;

create or replace function public.save_web_run(p jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare project uuid := public.my_project_id(); r jsonb; st jsonb; result_uuid uuid; scenario_uuid uuid; ordinal integer := 0;
begin
  if project is null then raise exception 'signed_out'; end if;
  insert into public.web_runs(id,project_id,trigger,status,total,passed,failed,started_at,ended_at,session_kept,viewport,browser)
  values((p->>'id')::uuid,project,p->>'trigger',p->>'status',jsonb_array_length(p->'scenarios'),(p->>'passed')::integer,(p->>'failed')::integer,(p->>'startedAt')::timestamptz,(p->>'ranAt')::timestamptz,(p->>'sessionKept')::boolean,p->'viewport',p->>'browser');
  for r in select value from jsonb_array_elements(p->'results') loop
    scenario_uuid := null;
    select id into scenario_uuid from public.web_scenario_items where project_id=project and id=(r->'scenario'->>'id')::uuid;
    insert into public.web_run_scenario_results(project_id,run_id,scenario_id,scenario_snapshot,sort_order,status,failed_step_no,message,started_at,elapsed_seconds,log)
    values(project,(p->>'id')::uuid,scenario_uuid,r->'scenario',ordinal,r->>'status',(r->>'failedStepIndex')::integer+1,r->>'message',(r->>'startedAt')::timestamptz,(r->>'elapsedSeconds')::numeric,coalesce(r->'log','[]'::jsonb)) returning id into result_uuid;
    ordinal := ordinal+1;
    for st in select value from jsonb_array_elements(r->'stepResults') loop
      insert into public.web_run_step_results(project_id,result_id,step_no,status,elapsed_ms,error_message,manual_verdict,manual_reason)
      values(project,result_uuid,(st->>'stepNo')::integer,st->>'status',(st->>'elapsedMs')::integer,st->>'errorMessage',st->>'manualVerdict',st->>'manualReason');
    end loop;
  end loop;
end $$;
revoke all on function public.save_web_scenario_document(jsonb), public.delete_web_scenario_document(uuid,timestamptz), public.save_web_run(jsonb) from public, anon;
grant execute on function public.save_web_scenario_document(jsonb), public.delete_web_scenario_document(uuid,timestamptz), public.save_web_run(jsonb) to authenticated;
