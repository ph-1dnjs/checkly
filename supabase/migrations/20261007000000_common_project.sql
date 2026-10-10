-- 공통: 프로젝트 · 멤버 · 엔드포인트 · 환경 (설계 초안)
-- 설명: docs/02-architecture/supabase-common.md
--
-- 계정 모델: auth 사용자 1명 = 프로젝트 멤버 1명.
-- 같은 사람이 프로젝트 3개에 가입하면 auth 사용자도 3개다(프로젝트마다 닉네임·비밀번호가 따로).
-- 로그인 이메일은 `<닉네임>.<프로젝트 코드>@<도메인>`으로 앱이 만들어 쓰며 실제로 발송하지 않는다.

-- ─── 테이블 ──────────────────────────────────────────────

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  -- 로그인 이메일에 들어가므로 만든 뒤 바꾸지 않는다.
  code        text not null unique check (code ~ '^[a-z0-9-]{3,32}$'),
  invite_code text not null unique check (invite_code ~ '^[A-Z]{3}-[A-HJ-NP-Z2-9]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

create table public.members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  nickname   text not null check (nickname ~ '^[a-z][a-z0-9_]{2,19}$'),
  role       text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (project_id, nickname)
);
create unique index members_one_owner on public.members (project_id) where role = 'owner';

-- 엔드포인트: 프론트(web)·백엔드(api) 등. 기능은 kind로 자기가 쓸 엔드포인트를 고른다.
create table public.endpoints (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 100),
  kind       text not null check (kind in ('web', 'api')),
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (project_id, name),
  unique (id, project_id)
);

create table public.environments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 100),
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (project_id, name),
  unique (id, project_id)
);

-- 엔드포인트 × 환경 = 주소. 복합 FK로 다른 프로젝트의 엔드포인트·환경과 섞이지 않게 한다.
create table public.endpoint_urls (
  project_id     uuid not null references public.projects(id) on delete cascade,
  endpoint_id    uuid not null,
  environment_id uuid not null,
  base_url       text not null check (base_url ~ '^https?://'),
  -- 스웨거 주소. kind = 'api' 엔드포인트에서만 쓴다. 문서 접근용 계정은 각자 로컬(OS 키체인)에 둔다.
  spec_url       text check (spec_url ~ '^https?://'),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  primary key (endpoint_id, environment_id),
  foreign key (endpoint_id, project_id) references public.endpoints (id, project_id) on delete cascade,
  foreign key (environment_id, project_id) references public.environments (id, project_id) on delete cascade
);

-- ─── 공통 함수 ───────────────────────────────────────────

-- 로그인한 사용자의 프로젝트. RLS 정책이 members를 다시 읽으며 재귀하지 않도록 security definer.
create function public.my_project_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select project_id from public.members where user_id = auth.uid()
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'owner')
$$;

-- 수정 시각·수정자. 동시 수정은 클라이언트가 `where updated_at = <읽은 값>`으로 갱신해 0행이면 충돌로 본다.
create function public.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger touch before insert or update on public.projects      for each row execute function public.touch();
create trigger touch before insert or update on public.endpoints     for each row execute function public.touch();
create trigger touch before insert or update on public.environments  for each row execute function public.touch();
create trigger touch before insert or update on public.endpoint_urls for each row execute function public.touch();

-- 초대코드: 프로젝트 코드 앞 영문 3자(부족하면 X) + '-' + 랜덤 6자(32^6 ≈ 10억). 256은 32의 배수라 나머지 연산에 치우침이 없다.
create function public.new_invite_code(p_code text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := uuid_send(gen_random_uuid());
  tail text := '';
begin
  -- v4 UUID의 0–5바이트는 버전·variant 비트가 없는 난수다.
  for i in 0..5 loop
    tail := tail || substr(alphabet, get_byte(bytes, i) % 32 + 1, 1);
  end loop;
  return rpad(upper(left(regexp_replace(p_code, '[^a-z]', '', 'g'), 3)), 3, 'X') || '-' || tail;
end $$;

-- ─── 가입 전(anon) 확인용 ───────────────────────────────

-- 가입 2단계 "프로젝트 확인" 화면.
create function public.preview_invite(p_invite text)
returns table (project_code text, owner_nickname text, member_count int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.code,
         (select m.nickname from public.members m where m.project_id = p.id and m.role = 'owner'),
         (select count(*)::int from public.members m where m.project_id = p.id),
         p.created_at
  from public.projects p
  where p.invite_code = upper(btrim(p_invite))
$$;

create function public.project_code_available(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_code ~ '^[a-z0-9-]{3,32}$'
     and not exists (select 1 from public.projects where code = p_code)
$$;

create function public.nickname_available(p_invite text, p_nickname text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_nickname ~ '^[a-z][a-z0-9_]{2,19}$'
     and exists (select 1 from public.projects where invite_code = upper(btrim(p_invite)))
     and not exists (
       select 1 from public.members m join public.projects p on p.id = m.project_id
       where p.invite_code = upper(btrim(p_invite)) and m.nickname = p_nickname)
$$;

-- ─── Edge Function(service_role) 전용 ──────────────────
-- auth 사용자 생성은 Admin API로 Edge Function이 하고, 아래 함수로 프로젝트·멤버를 붙인다.
-- 함수가 실패하면 Edge Function이 방금 만든 auth 사용자를 지운다.

create function public.create_project_for(p_user uuid, p_code text, p_nickname text)
returns table (project_id uuid, invite_code text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_invite text;
begin
  -- 초대코드가 겹치면 다시 뽑는다.
  loop
    v_invite := public.new_invite_code(p_code);
    exit when not exists (select 1 from public.projects where projects.invite_code = v_invite);
  end loop;
  insert into public.projects (code, invite_code) values (p_code, v_invite) returning id into v_id;
  insert into public.members (user_id, project_id, nickname, role) values (p_user, v_id, p_nickname, 'owner');
  return query select v_id, v_invite;
end $$;

create function public.join_project_for(p_user uuid, p_invite text, p_nickname text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.projects where projects.invite_code = upper(btrim(p_invite));
  if v_id is null then
    raise exception 'invalid_invite' using errcode = 'P0002';
  end if;
  insert into public.members (user_id, project_id, nickname) values (p_user, v_id, p_nickname);
  return v_id;
end $$;

-- ─── 관리자 ─────────────────────────────────────────────

create function public.regenerate_invite_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_project uuid := public.my_project_id();
  v_invite text;
begin
  if not public.is_owner() then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  loop
    v_invite := public.new_invite_code((select code from public.projects where id = v_project));
    exit when not exists (select 1 from public.projects where invite_code = v_invite);
  end loop;
  update public.projects set invite_code = v_invite where id = v_project;
  return v_invite;
end $$;

-- ─── 권한 ───────────────────────────────────────────────

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_project_id(), public.is_owner() to authenticated;
grant execute on function public.preview_invite(text), public.project_code_available(text),
  public.nickname_available(text, text) to anon, authenticated;
grant execute on function public.regenerate_invite_code() to authenticated;
grant execute on function public.create_project_for(uuid, text, text),
  public.join_project_for(uuid, text, text) to service_role;

alter table public.projects      enable row level security;
alter table public.members       enable row level security;
alter table public.endpoints     enable row level security;
alter table public.environments  enable row level security;
alter table public.endpoint_urls enable row level security;

-- 프로젝트·멤버: 읽기만. 생성·가입·닉네임 변경·내보내기는 함수와 Edge Function으로만 한다.
create policy "같은 프로젝트" on public.projects for select to authenticated using (id = public.my_project_id());
create policy "같은 프로젝트" on public.members  for select to authenticated using (project_id = public.my_project_id());

-- 엔드포인트·환경·주소: 멤버 누구나 읽고 고친다.
create policy "같은 프로젝트" on public.endpoints for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
create policy "같은 프로젝트" on public.environments for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
create policy "같은 프로젝트" on public.endpoint_urls for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
