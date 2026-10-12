-- API 테스트: 시나리오·스위트 작성자 (누가 만들었고 누가 마지막으로 고쳤는지. 버전 기록은 없다)
-- 설명: docs/02-architecture/supabase-common.md, docs/04-pages/070-api-testing/01-overview.md
--
-- created_at·created_by  만든 시각·사람. 아래 트리거가 추가할 때 채우고 수정할 때는 원래 값으로 되돌린다
--                        (앱이 보낸 값은 무시하므로 다른 사람을 작성자로 꾸밀 수 없다).
-- updated_at·updated_by  마지막으로 고친 시각·사람. 지금처럼 public.touch()가 채운다.

alter table public.api_scenarios
  add column created_by uuid references auth.users(id) on delete set null default auth.uid();

alter table public.api_suites
  add column created_by uuid references auth.users(id) on delete set null default auth.uid();

-- 기존 행: 만든 사람을 알 수 없으므로 마지막으로 고친 사람으로 둔다.
-- api_suites의 touch 트리거는 모든 수정에 updated_at·updated_by를 다시 찍으므로 채우는 동안만 끈다.
update public.api_scenarios set created_by = updated_by where created_by is null;
alter table public.api_suites disable trigger touch;
update public.api_suites set created_by = updated_by where created_by is null;
alter table public.api_suites enable trigger touch;

create function public.api_authorship() returns trigger
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

create trigger authorship before insert or update on public.api_scenarios for each row execute function public.api_authorship();
create trigger authorship before insert or update on public.api_suites    for each row execute function public.api_authorship();
