# 공통 프로젝트 · Supabase (설계 초안)

> 상태: 초안. SQL은 [`supabase/migrations/20261007000000_common_project.sql`](../../supabase/migrations/20261007000000_common_project.sql).
> 기능 담당자용 사용법과 남은 할 일: [supabase-guide.md](supabase-guide.md)
> 화면 기준: 디자인 시스템 `Checkly v21.dc.html`의 `시작 · 로그인`, `시작 · 초대코드 가입`, `시작 · 새 프로젝트`, `설정 · 계정 카드`.

## 결정 사항

- **팀 프로젝트 1개를 세 기능(웹 시나리오, 폼 자동 완성, API 테스트)이 같이 쓴다.** API 테스트의 프로젝트와 팀 프로젝트는 1:1이다.
- 팀이 같이 쓰는 문서형 데이터는 Supabase DB에 둔다. 캐시, 개인 설정, AI 대화, 영상은 로컬에 둔다.
- 프로젝트 설정에 **엔드포인트 × 환경별 주소**를 두고, 각 기능은 자기 화면에서 환경을 고른다.
  - 고른 환경은 개인별·기능별로 로컬에 저장한다.

## 계정 모델

시안의 로그인은 **프로젝트 코드 + 닉네임 + 비밀번호**다. 같은 사람이라도 프로젝트마다 닉네임과 비밀번호가 따로 있다.
그래서 **auth 사용자 1명 = 프로젝트 멤버 1명**으로 둔다.

- 로그인 이메일은 앱이 `<닉네임>.<프로젝트 코드>@<도메인>`으로 만들어 쓰고, 실제 메일은 보내지 않는다(이메일 확인 끔).
  - `<도메인>`은 앱과 Edge Function이 같이 읽는 설정값 하나(`CHECKLY_AUTH_EMAIL_DOMAIN`)로 둔다. 개발 중에는 임시값을 쓰고, **실사용자 가입 전에 확정**한다. 가입자가 생긴 뒤 바꾸면 전체 계정 이메일을 일괄 변경해야 한다.
- 비밀번호는 **6자 이상**이다(Supabase Auth 기본값). 시안의 "4자 이상" 안내와 검사를 6자로 바꾼다.
- 그래서 **프로젝트 코드는 만든 뒤 바꿀 수 없다.** 닉네임을 바꿀 때는 auth 이메일도 같이 바꿔야 하므로 Edge Function으로 처리한다.
- 프로젝트 변경(설정 모달) = 그 프로젝트 계정으로 다시 로그인. 시안과 같다.

## 화면 흐름 → 호출

| 화면 | 호출 | 권한 |
| --- | --- | --- |
| 로그인 | `auth.signInWithPassword(가상 이메일, 비밀번호)` | anon |
| 가입 1 · 초대코드 입력 / 2 · 프로젝트 확인 | `rpc preview_invite(초대코드)` → 코드, 관리자, 팀원 수, 만든 날 | anon |
| 가입 3 · 계정 설정 | 입력 중 `rpc nickname_available(초대코드, 닉네임)` → **Edge Function `join-project`** | anon |
| 새 프로젝트 1 | 입력 중 `rpc project_code_available(코드)` → **Edge Function `create-project`**(운영자가 준 생성 코드 필요) | anon + 생성 코드 |
| 새 프로젝트 2 · 초대코드 공유 | `create-project` 응답의 초대코드 | — |
| 설정 · 계정 카드 | `projects`, `members` 조회 | 멤버 |
| 설정 · 초대코드 재발급 | `rpc regenerate_invite_code()` | 관리자 |
| 설정 · 로그아웃 | `auth.signOut()` | 멤버 |

**Edge Function (service_role)**

| 함수 | 하는 일 |
| --- | --- |
| `create-project` | **생성 코드 확인**(`createCode` ↔ secret `CHECKLY_CREATE_PROJECT_CODE`, 상수 시간 비교, 다른 검증보다 먼저) → 입력값 확인 → Admin API로 auth 사용자 생성 → `create_project_for(user, code, nick)`. 실패하면 사용자 삭제. 초대코드 반환. 코드가 틀리거나 없으면 403 `invalid_create_code`, secret이 비어 있으면 403 `create_disabled`(누구도 못 만듦) |
| `join-project` | 입력값 확인 → auth 사용자 생성 → `join_project_for(user, invite, nick)`. 실패하면 사용자 삭제 |
| `change-nickname` | auth 이메일과 `members.nickname`을 같이 변경 (프로필 관리) |
| `remove-member` | 관리자가 멤버를 내보냄 → auth 사용자 삭제(멤버 행은 cascade) |

## 테이블

| 테이블 | 내용 | 주요 제약 |
| --- | --- | --- |
| `projects` | 코드, 초대코드 | 코드 `^[a-z0-9-]{3,32}$` 유일, 초대코드 `XXX-XXXXXX`(랜덤 6자) 유일 |
| `members` | auth 사용자 ↔ 프로젝트, 닉네임, 역할 | 닉네임 `^[a-z][a-z0-9_]{2,19}$` 프로젝트 안에서 유일, 관리자는 프로젝트당 1명 |
| `endpoints` | 프론트·백엔드 등. `kind`: `web` / `api` | 이름은 프로젝트 안에서 유일 |
| `environments` | dev / staging / prod 등 | 이름은 프로젝트 안에서 유일 |
| `endpoint_urls` | 엔드포인트 × 환경 → `base_url`, `spec_url`(api만) | 복합 FK로 다른 프로젝트 것과 섞이지 않음 |

- 엔드포인트 × 환경 주소는 모든 쌍을 채우지 않아도 된다. 행이 없으면 '미설정'이다. 각 기능이 자기에게 필요한 쌍이 비어 있으면 안내한다.
- 수정되는 테이블에는 모두 `updated_at`, `updated_by`가 있고 트리거가 채운다.
- **동시 수정**: 읽을 때 받은 `updated_at`을 조건으로 갱신하고(`… where id = ? and updated_at = ?`), 0행이면 충돌로 처리한다. 지금 API 테스트의 `expectedUpdatedAt` 방식과 같다.

엔드포인트 예시:

| 엔드포인트 (kind) | dev | staging | prod |
| --- | --- | --- | --- |
| 프론트 (`web`) | `https://dev.app.com` | `https://stg.app.com` | `https://app.com` |
| 백엔드 (`api`) | `https://dev-api.app.com` + 스웨거 주소 | … | … |

API 테스트의 지금 구조와 1:1로 대응한다: `servers` → `endpoints`, `environments` → `environments`, `baseUrls` → `endpoint_urls.base_url`, `spec-source-*.json` → `endpoint_urls.spec_url`.

## RLS

- `my_project_id()`: 로그인한 사용자의 프로젝트. 모든 정책은 `project_id = my_project_id()` 하나로 판단한다.
- `projects`, `members`: 읽기만 가능하다. 쓰기는 위 함수와 Edge Function으로만 한다.
- `endpoints`, `environments`, `endpoint_urls`: 멤버 누구나 읽고 쓸 수 있다. 관리자가 1명뿐이라 관리자만 고치게 하면 병목이 되므로, 대신 `updated_by`로 누가 바꿨는지 남긴다.
- anon은 테이블을 직접 못 읽고, 가입 전 확인용 함수 3개만 호출할 수 있다.

**기능 테이블 규칙** (세 기능 담당자 공통)

```sql
create table public.<기능>_<이름> (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- 기능 데이터 …
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create trigger touch before insert or update on public.<테이블> for each row execute function public.touch();
alter table public.<테이블> enable row level security;
create policy "같은 프로젝트" on public.<테이블> for all to authenticated
  using (project_id = public.my_project_id()) with check (project_id = public.my_project_id());
```

## Electron 배치

- Supabase 클라이언트는 **main 프로세스**에 둔다. 렌더러는 지금처럼 preload IPC로 요청한다.
  - API 테스트 저장소(`ApiWorkspace`)가 이미 main에 있다.
  - 세션 토큰이 렌더러(webview 포함)에 노출되지 않는다.
- 세션은 `auth.storage` 어댑터로 `userData`에 저장하고 `safeStorage`로 암호화한다.
- URL과 anon 키는 빌드 시 주입한다. **service_role 키는 앱에 절대 넣지 않는다**(Edge Function 환경 변수에만).
- 설정: `.env`의 `CHECKLY_SUPABASE_URL`, `CHECKLY_SUPABASE_ANON_KEY`, `CHECKLY_AUTH_EMAIL_DOMAIN`(기본 `checkly.test`). URL이나 키가 없으면 로그인 없이 기존 로컬 모드로 동작한다.

| 위치 | 역할 |
| --- | --- |
| `src/app/ipc/auth/types.ts` | IPC 계약(`AuthBridge`). renderer는 `window.electronAPI.auth` |
| `src/app/ipc/auth/client.ts` | main 안의 다른 기능용: `isSupabaseEnabled`, `getSupabase`, `getCurrentSession`, `onSessionChanged` |
| `src/app/ipc/auth/{service,settings,storage,errors}.ts` | 로그인·가입·프로필, 설정 저장, 암호화 세션 저장, 한국어 오류 변환 |
| `supabase/functions/*` | `create-project`, `join-project`, `change-nickname`, `remove-member` |

- IPC 채널은 `auth:<메서드>`, 세션 변경 알림은 `auth:session`. 실패는 `{ ok: false, message }`로 돌려주고 bridge가 `Error(message)`로 reject한다.
- 프로젝트 설정 저장은 `save_project_settings(p jsonb)` 한 번으로 한다(한 트랜잭션, security invoker). main이 마지막으로 읽은 행 중 빠진 것만 지우고, 읽은 뒤 다른 팀원이 추가·수정한 행이 있으면 충돌로 거절한다.

## 접속 서버 정하기

| 실행 | 접속 서버 |
| --- | --- |
| 배포용 앱(패키징) | `src/app/ipc/auth/release-config.ts`의 팀 클라우드(주소·anon 키 커밋). 환경 변수가 있으면 그 값 |
| 개발 실행(`npm run dev`, 테스트) | `.env`만 따른다. 없으면 로그인 없는 로컬 모드 |

- 팀 클라우드로 개발: `.env`에 `release-config.ts`의 주소·anon 키를 넣는다(`.env.example` 참고).
- 로컬 Docker로 개발: 아래 "로컬 개발" 후 `supabase status`의 값을 넣는다.
- `CHECKLY_SUPABASE_URL=`처럼 빈 값을 주면 패키징된 앱도 로컬 모드로 끈다.

## 운영: 새 프로젝트 생성 코드 · 공개 가입

- 새 프로젝트는 **운영자가 발급한 생성 코드**를 아는 사람만 만들 수 있다. 화면 `시작 · 새 프로젝트`의 "생성 코드" 칸에 넣는다(초대코드 가입은 그대로).
- 코드는 Edge Function secret `CHECKLY_CREATE_PROJECT_CODE` 하나다. 저장소에는 값을 두지 않는다.
  - 클라우드 설정·교체: `supabase secrets set CHECKLY_CREATE_PROJECT_CODE=<새 값>` → 함수가 다음 요청부터 새 값을 쓴다(재배포 불필요). 이전 코드는 바로 무효.
  - 생성 막기: `supabase secrets unset CHECKLY_CREATE_PROJECT_CODE`(또는 빈 값) → 모두 `create_disabled`.
  - 로컬: `supabase/functions/.env`(gitignore)에 `CHECKLY_CREATE_PROJECT_CODE=<개발용 값>`을 두면 `supabase functions serve`가 읽는다. 값을 바꾸면 serve를 다시 띄운다. 테스트(`tests/supabase`, `tests/auth`)와 `team-check.ts`도 이 파일(또는 같은 이름 환경 변수)에서 읽는다.
- **공개 가입은 끈다**: `supabase/config.toml` `[auth] enable_signup = false`, `[auth.email] enable_signup = false`. 계정은 함수가 Admin API(`auth.admin.createUser`)로만 만들고, 이 설정과 상관없이 동작한다.
  - 로컬은 `supabase stop && supabase start` 뒤에 적용된다. 클라우드는 대시보드 Authentication › Sign In / Providers의 "Allow new users to sign up"을 끄거나 `supabase config push`로 맞춘다.

## 로컬 개발

```bash
supabase start                 # Postgres·Auth·Edge Runtime 등 (Docker)
supabase functions serve       # Edge Function (start에 안 올라오면)
supabase migration up          # 새 마이그레이션 적용 (db reset은 데이터가 지워짐)
npm run test:supabase          # Edge Function 통합 테스트
npx tsx --test tests/auth/*.test.ts
```

## 기능별 데이터

### 1. 웹 시나리오 (담당: 팀원)

| 구분 | 데이터 |
| --- | --- |
| DB | 시나리오 본문(`.md`), 마커 위치(`marker-positions.json`) |
| 로컬 | 영상, `report.html`, 폴더 선택(`scenario-folder.json`, 유지 여부는 담당자가 정함) |
| 환경 | 선택한 환경의 `web` 엔드포인트 주소를 상대 경로의 기준으로 씀 (새 기능) |

### 2. 폼 자동 완성 (담당: 팀원)

| 구분 | 데이터 |
| --- | --- |
| DB | 저장한 입력 세트(`checkly-form-saved-cases`), 오버라이드 규칙(`checkly-form-overrides`) |
| 로컬 | 대상 URL 입력값, 브라우저 세션 탭, 패널 크기·줌, 세션 이벤트 로그 |
| 없어짐 | `checkly-form-openapi` → 프로젝트의 `api` 엔드포인트 `spec_url` 사용 |
| 환경 | 선택한 환경의 `web` 주소 + `api` 스펙 |

### 3. API 테스트 (담당: 본인)

| 구분 | 데이터 |
| --- | --- |
| DB | 시나리오·묶음(`api_scenarios`, `api_suites`), 개별 요청 입력값(`api_doc_inputs`), 설정(`api_settings`), 문서 계정(`api_spec_accounts`, 공유가 켜져 있을 때만) |
| 공통으로 이동 | `projects.json`의 서버·환경·주소, `spec-source-*`의 명세 주소 → 위 공통 테이블 |
| 로컬 | 명세·카탈로그 캐시(`catalog-*`, 각자 팀의 명세 주소에서 가져옴), `ai/*`, AI 대화·설정, 동기화 상태, 공유를 끈 경우의 문서 계정(키체인) |
| 없어짐 | `share-origins.json`, `share-bases.json`(내보내기·가져오기 공유), API 테스트 안의 프로젝트 목록·생성·삭제 UI |
| 이전 | 최초 1회 "로컬 프로젝트 → 현재 팀 프로젝트로 가져오기" (기존 가져오기 코드 재사용) |

API 테스트 테이블 (`20261007000200_api_testing.sql`, `20261009000000_api_share_secrets.sql`, `20261009000200_api_authorship.sql`)

| 테이블 | 키 | 내용 |
| --- | --- | --- |
| `api_scenarios`, `api_suites` | (project_id, id) | 시나리오 YAML·묶음 순서. 작성 정보: `created_at`·`created_by`(트리거가 추가 때 `now()`·`auth.uid()`로 채우고 수정 때 원래 값으로 되돌림 → 다른 사람을 작성자로 꾸밀 수 없음), `updated_at`·`updated_by`(`touch()`). |
| `api_settings` | project_id | `share_secrets`(기본 true). 멤버 누구나 바꾸고 `updated_by`가 남음 |
| `api_spec_accounts` | (endpoint_id, environment_id), 복합 FK·cascade | 명세 주소의 Basic 계정(`spec_url`, `username`, `password` 평문). 추가·수정 RLS는 `api_shares_secrets()`가 참일 때만 |

- 명세 본문은 DB에 두지 않는다. 팀은 명세 주소(`endpoint_urls.spec_url`)와, 비밀값 공유가 켜져 있으면 그 주소의 Basic 계정만 같이 쓰고, 각 PC가 그 주소에서 직접 가져와 로컬 카탈로그 캐시로 둔다. 접속할 수 없는 주소(예: 다른 사람 PC의 localhost)는 가져올 수 없다.
- 작성 정보(1단계, 버전 기록 없음): 앱은 `created_by`·`updated_by`를 `members`의 닉네임으로 바꿔 보여 주고(세션 캐시, 모르는 id가 나오면 한 번 다시 읽음), 멤버가 아닌 id는 `(나간 멤버)`로 표시한다. 기존 행은 `created_by = updated_by`로 채웠다.
- 비밀값 공유를 끄면 앱이 `api_spec_accounts`를 지우고 `api_doc_inputs`의 비밀값을 뺀다(`shared/sensitive.ts` 기준).

공통 규칙
- 토큰·비밀번호 같은 값은 `{{globals.이름}}` 변수로 빼고, 실제 값은 각자 로컬에 둔다. DB에 저장된 값은 평문이다. 예외: API 테스트의 `비밀값도 팀에 공유`(기본 켬)가 켜져 있으면 Try it out 입력값의 비밀값과 문서 계정을 DB에 평문으로 둔다(개발용 계정 전제, 운영 계정을 쓰는 프로젝트는 끈다).
- 실행 기록은 DB에 저장하지 않는다. 웹 시나리오는 각자 PC의 `reports/`·영상, API 테스트는 화면 세션 동안의 마지막 실행과 직접 저장한 스위트 HTML 리포트만 둔다.

## 열린 질문

1. **로그인 이메일 도메인**: 실사용자 가입 전에 확정한다. Auth 이메일 형식 검사를 통과하는지 확인한다.
2. **관리자 탈퇴·위임**: 관리자 계정이 삭제되면 관리자 없는 프로젝트가 된다. 위임 기능이 필요한가?
3. **스웨거 파일 업로드**: API 테스트는 URL 말고 파일로도 스펙을 넣을 수 있다. 파일 스펙은 공유하지 않는다(각 PC에만 둠). 공유한다면 Storage나 컬럼이 따로 필요하다.
