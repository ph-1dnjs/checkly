-- 프로젝트 설정(엔드포인트 · 환경 · 주소) 한 번에 저장
-- 설명: docs/02-architecture/supabase-common.md
--
-- 앱(main)이 화면의 표 전체를 보내면 추가·수정·삭제를 한 트랜잭션으로 처리한다.
-- security invoker라 RLS(같은 프로젝트)가 그대로 적용된다.
--
-- p = { endpoints: [행], environments: [행], urls: [행], deleted: { endpoints, environments, urls } }
--   행은 테이블 열 이름(snake_case)을 쓴다. updated_at이 없으면 새 행이다.
--   deleted는 앱이 마지막으로 읽었던 행 중 이번 입력에서 빠진 것(읽었던 updated_at 포함)이다.
--
-- 충돌(다른 팀원이 먼저 수정)이면 'settings_conflict'로 실패한다.
--   ① 입력 행의 updated_at이 DB와 다르다(읽은 뒤 바뀌었거나 지워졌거나, 새 행인데 이미 있다).
--   ② 입력에 없는 DB 행이 deleted에 같은 updated_at으로 없다(읽은 뒤 추가됐거나 바뀌었다).

create function public.save_project_settings(p jsonb) returns void
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_project uuid := public.my_project_id();
begin
  if v_project is null then
    raise exception 'not_member' using errcode = '42501';
  end if;
  -- 같은 프로젝트의 저장은 하나씩 처리한다.
  perform pg_advisory_xact_lock(hashtext('project_settings:' || v_project::text));

  if exists (
       select 1 from jsonb_populate_recordset(null::public.endpoints, p->'endpoints') x
       left join public.endpoints e on e.id = x.id
       where e.updated_at is distinct from x.updated_at)
  or exists (
       select 1 from jsonb_populate_recordset(null::public.environments, p->'environments') x
       left join public.environments e on e.id = x.id
       where e.updated_at is distinct from x.updated_at)
  or exists (
       select 1 from jsonb_populate_recordset(null::public.endpoint_urls, p->'urls') x
       left join public.endpoint_urls u on u.endpoint_id = x.endpoint_id and u.environment_id = x.environment_id
       where u.updated_at is distinct from x.updated_at)
  or exists (
       select 1 from public.endpoints e
       where e.project_id = v_project
         and not exists (select 1 from jsonb_populate_recordset(null::public.endpoints, p->'endpoints') x
                         where x.id = e.id)
         and not exists (select 1 from jsonb_populate_recordset(null::public.endpoints, p->'deleted'->'endpoints') d
                         where d.id = e.id and d.updated_at = e.updated_at))
  or exists (
       select 1 from public.environments e
       where e.project_id = v_project
         and not exists (select 1 from jsonb_populate_recordset(null::public.environments, p->'environments') x
                         where x.id = e.id)
         and not exists (select 1 from jsonb_populate_recordset(null::public.environments, p->'deleted'->'environments') d
                         where d.id = e.id and d.updated_at = e.updated_at))
  or exists (
       select 1 from public.endpoint_urls u
       where u.project_id = v_project
         and not exists (select 1 from jsonb_populate_recordset(null::public.endpoint_urls, p->'urls') x
                         where x.endpoint_id = u.endpoint_id and x.environment_id = u.environment_id)
         and not exists (select 1 from jsonb_populate_recordset(null::public.endpoint_urls, p->'deleted'->'urls') d
                         where d.endpoint_id = u.endpoint_id and d.environment_id = u.environment_id
                           and d.updated_at = u.updated_at))
  then
    raise exception 'settings_conflict';
  end if;

  -- 지우기: 입력에 없는 행. 엔드포인트·환경을 지우면 그 주소도 같이 지워진다.
  delete from public.endpoint_urls u
  where u.project_id = v_project
    and not exists (select 1 from jsonb_populate_recordset(null::public.endpoint_urls, p->'urls') x
                    where x.endpoint_id = u.endpoint_id and x.environment_id = u.environment_id);
  delete from public.endpoints e
  where e.project_id = v_project
    and not exists (select 1 from jsonb_populate_recordset(null::public.endpoints, p->'endpoints') x where x.id = e.id);
  delete from public.environments e
  where e.project_id = v_project
    and not exists (select 1 from jsonb_populate_recordset(null::public.environments, p->'environments') x where x.id = e.id);

  -- 추가·수정: 값이 바뀐 행만 고쳐서 그대로인 행의 updated_at을 유지한다.
  insert into public.endpoints as t (id, project_id, name, kind, position)
  select x.id, v_project, x.name, x.kind, x.position
  from jsonb_populate_recordset(null::public.endpoints, p->'endpoints') x
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, position = excluded.position
  where (t.name, t.kind, t.position) is distinct from (excluded.name, excluded.kind, excluded.position);

  insert into public.environments as t (id, project_id, name, position)
  select x.id, v_project, x.name, x.position
  from jsonb_populate_recordset(null::public.environments, p->'environments') x
  on conflict (id) do update set name = excluded.name, position = excluded.position
  where (t.name, t.position) is distinct from (excluded.name, excluded.position);

  insert into public.endpoint_urls as t (project_id, endpoint_id, environment_id, base_url, spec_url)
  select v_project, x.endpoint_id, x.environment_id, x.base_url, x.spec_url
  from jsonb_populate_recordset(null::public.endpoint_urls, p->'urls') x
  on conflict (endpoint_id, environment_id) do update set base_url = excluded.base_url, spec_url = excluded.spec_url
  where (t.base_url, t.spec_url) is distinct from (excluded.base_url, excluded.spec_url);
end $$;

revoke execute on function public.save_project_settings(jsonb) from public, anon;
grant execute on function public.save_project_settings(jsonb) to authenticated;
