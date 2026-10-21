-- ph-1dnjs 2026-10-16: 웹 시나리오 시작 주소를 본문 url 대신 설정의 웹 엔드포인트 ID로 연결.
-- 선행 조건: 20261014000000_web_scenario_runs.sql 적용 완료. 다시 실행해도 안전하다.
alter table public.web_scenario_items add column if not exists endpoint_id uuid references public.endpoints(id) on delete set null;

-- 본문의 endpoint 값이 같은 프로젝트의 웹 엔드포인트일 때만 연결하고, 아니면 null로 둔다.
create or replace function public.save_web_scenario_document(p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  project uuid := public.my_project_id();
  doc public.web_scenarios;
  s jsonb; st jsonb; scenario_uuid uuid; step_number integer; endpoint uuid;
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
    endpoint := null;
    select e.id into endpoint from public.endpoints e where e.project_id=project and e.kind='web' and e.id::text=s->>'endpointId';
    insert into public.web_scenario_items(id,project_id,document_id,code,title,base_url,endpoint_id,tag,sort_order)
    values(scenario_uuid,project,doc.id,s->>'code',s->>'title',coalesce(s->>'url',''),endpoint,s->>'tag',(s->>'sortOrder')::integer)
    on conflict(id) do update set code=excluded.code,title=excluded.title,base_url=excluded.base_url,endpoint_id=excluded.endpoint_id,tag=excluded.tag,sort_order=excluded.sort_order,deleted_at=null;
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
revoke all on function public.save_web_scenario_document(jsonb) from public, anon;
grant execute on function public.save_web_scenario_document(jsonb) to authenticated;
