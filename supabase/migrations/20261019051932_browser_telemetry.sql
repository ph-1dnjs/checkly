-- Codex 2026-10-19: 팀 브라우저 API·이동 로그와 오류 전후 5초 rrweb 기록 공유. 클라우드 적용 여부는 별도 확인.
create table if not exists public.form_browser_logs (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  browser_session_id uuid not null,
  source text not null check (source in ('browser', 'scenario')),
  kind text not null check (kind in ('fetch', 'xhr', 'navigation', 'page-error', 'resource-error', 'unhandled-rejection', 'console-error')),
  occurred_at timestamptz not null,
  url text not null,
  page_url text not null default '',
  method text,
  status integer check (status between 0 and 599),
  duration_ms integer check (duration_ms between 0 and 86400000),
  is_error boolean not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists form_browser_logs_project_time on public.form_browser_logs(project_id, occurred_at desc);
create index if not exists form_browser_logs_session_time on public.form_browser_logs(project_id, browser_session_id, occurred_at);
create index if not exists form_browser_logs_created_by on public.form_browser_logs(created_by);
create index if not exists form_browser_logs_updated_by on public.form_browser_logs(updated_by);

drop trigger if exists touch on public.form_browser_logs;
create trigger touch before insert or update on public.form_browser_logs for each row execute function public.touch();
alter table public.form_browser_logs enable row level security;
revoke all on public.form_browser_logs from anon, authenticated;
grant select, insert on public.form_browser_logs to authenticated;
drop policy if exists "팀 로그 읽기" on public.form_browser_logs;
create policy "팀 로그 읽기" on public.form_browser_logs for select to authenticated
  using (project_id = (select public.my_project_id()));
drop policy if exists "내 팀 로그 추가" on public.form_browser_logs;
create policy "내 팀 로그 추가" on public.form_browser_logs for insert to authenticated
  with check (project_id = (select public.my_project_id()) and created_by = (select auth.uid()));

create table if not exists public.form_browser_recordings (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  browser_session_id uuid not null,
  -- 로그 전송과 Storage 업로드는 독립 재시도하므로 FK를 두지 않는다.
  trigger_log_id uuid,
  started_at timestamptz not null,
  object_path text not null unique,
  metadata jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (metadata->>'id' = id::text),
  check (metadata->'team'->>'projectId' = project_id::text)
);
create index if not exists form_browser_recordings_project_time on public.form_browser_recordings(project_id, started_at desc);
create index if not exists form_browser_recordings_created_by on public.form_browser_recordings(created_by);
create index if not exists form_browser_recordings_updated_by on public.form_browser_recordings(updated_by);

-- 작성자와 저장 경로는 수정 때 보존한다. 기존 공통 테이블·함수는 바꾸지 않는다.
create or replace function public.form_browser_recording_author() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.project_id := old.project_id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.object_path := old.object_path;
  end if;
  return new;
end $$;
revoke all on function public.form_browser_recording_author() from public, anon, authenticated;
drop trigger if exists author on public.form_browser_recordings;
create trigger author before insert or update on public.form_browser_recordings for each row execute function public.form_browser_recording_author();
drop trigger if exists touch on public.form_browser_recordings;
create trigger touch before insert or update on public.form_browser_recordings for each row execute function public.touch();
alter table public.form_browser_recordings enable row level security;
revoke all on public.form_browser_recordings from anon, authenticated;
grant select, insert, update, delete on public.form_browser_recordings to authenticated;
drop policy if exists "팀 오류 기록 읽기" on public.form_browser_recordings;
create policy "팀 오류 기록 읽기" on public.form_browser_recordings for select to authenticated
  using (project_id = (select public.my_project_id()));
drop policy if exists "내 오류 기록 추가" on public.form_browser_recordings;
create policy "내 오류 기록 추가" on public.form_browser_recordings for insert to authenticated
  with check (project_id = (select public.my_project_id()) and created_by = (select auth.uid())
    and object_path = project_id::text || '/' || (select auth.uid())::text || '/' || id::text || '.json.gz');
drop policy if exists "내 오류 기록 갱신" on public.form_browser_recordings;
create policy "내 오류 기록 갱신" on public.form_browser_recordings for update to authenticated
  using (project_id = (select public.my_project_id()) and created_by = (select auth.uid()))
  with check (project_id = (select public.my_project_id()) and created_by = (select auth.uid()));
drop policy if exists "팀 오류 기록 삭제" on public.form_browser_recordings;
create policy "팀 오류 기록 삭제" on public.form_browser_recordings for delete to authenticated
  using (project_id = (select public.my_project_id()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('browser-error-replays', 'browser-error-replays', false, 52428800, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "팀 브라우저 기록 읽기" on storage.objects;
create policy "팀 브라우저 기록 읽기" on storage.objects for select to authenticated
  using (bucket_id = 'browser-error-replays' and (storage.foldername(name))[1] = (select public.my_project_id())::text);
drop policy if exists "내 브라우저 기록 추가" on storage.objects;
create policy "내 브라우저 기록 추가" on storage.objects for insert to authenticated
  with check (bucket_id = 'browser-error-replays' and (storage.foldername(name))[1] = (select public.my_project_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text);
drop policy if exists "내 브라우저 기록 갱신" on storage.objects;
create policy "내 브라우저 기록 갱신" on storage.objects for update to authenticated
  using (bucket_id = 'browser-error-replays' and (storage.foldername(name))[1] = (select public.my_project_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text)
  with check (bucket_id = 'browser-error-replays' and (storage.foldername(name))[1] = (select public.my_project_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text);
drop policy if exists "팀 브라우저 기록 삭제" on storage.objects;
create policy "팀 브라우저 기록 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'browser-error-replays' and (storage.foldername(name))[1] = (select public.my_project_id())::text);
