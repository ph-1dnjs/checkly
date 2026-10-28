# 팀 프로젝트(Supabase) 개발 가이드

> 설계(왜·무엇)는 [supabase-common.md](supabase-common.md), 이 문서는 기능 담당자가 **어떻게 붙이는지**와 **남은 할 일**이다.
> 규칙: 할 일을 처리하면 같은 커밋에서 아래 체크리스트와 해당 설명을 고친다.

## 모든 기능이 맞출 것

| 항목 | 규칙 |
| --- | --- |
| 프로젝트 | 팀 프로젝트 하나를 세 기능이 같이 쓴다. 기능별 프로젝트 목록·생성·삭제를 따로 두지 않고 로그인 세션의 `projectId`를 쓴다 |
| 엔드포인트·환경 | 주소와 환경 목록을 기능 안에 따로 저장하지 않는다. 설정의 **엔드포인트 × 환경** 표(`endpoints`·`environments`·`endpoint_urls`)를 읽는다. 프론트는 kind `web`, 백엔드·스웨거는 kind `api` |
| 환경 선택 | 지금 고른 환경은 개인·기능별로 로컬에 저장한다(팀원 화면을 바꾸지 않는다) |
| 미설정 | 필요한 엔드포인트 × 환경 칸이 비어 있으면 화면에서 "설정에서 주소를 넣으라"고 안내한다 |
| 팀 모드 / 로컬 모드 | 로그인했을 때만 DB를 쓴다. 웹 시나리오·API 테스트는 DB 전용이며 비로그인 시 로그인 안내를 표시한다. Supabase 설정이 없는 개발·테스트 실행만 로컬 파일을 쓴다 |
| 세션 변경 | 로그아웃·프로젝트 변경(`onSessionChange`) 때 프로젝트별 캐시를 비운다. 프로젝트 변경 시 앱은 다시 불러온다 |
| 공유 데이터 | 무엇을 DB로 공유할지는 담당자가 정한다. 정하면 아래 "기능 테이블 규칙"으로 만든다. 캐시·PC 경로·개인 설정은 공유하지 않는다 |
| 테이블 이름 | `<기능>_<이름>`(예: `api_scenarios`). 공통 테이블(`projects`·`members`·`endpoints`·`environments`·`endpoint_urls`)은 고치지 말고 필요하면 운영자와 상의한다 |
| 작성자 표시 | 공유하는 문서는 `created_by`·`updated_by`를 두고 "minsu 작성 · hyewon 수정 · 3분 전" 형식으로 보여 준다 |
| 동시 수정 | 읽은 `updated_at`으로 갱신하고 0행이면 "다른 팀원이 먼저 수정했습니다…"로 안내한다 |
| 비밀값 | 운영 계정·실서비스 토큰은 공유 데이터에 넣지 않는다(DB는 평문) |

## 1. 개발 환경 고르기

| 하고 싶은 것 | 할 일 |
| --- | --- |
| 지금처럼 개발 | 아무것도 안 한다. `.env`에 Supabase 값이 없으면 로그인 없는 로컬 모드 |
| 팀 클라우드로 로그인까지 개발 | `.env`에 `src/app/ipc/auth/release-config.ts`의 주소·anon 키를 넣는다(`.env.example` 참고) |
| 클라우드를 건드리지 않고 개발(선택) | Docker + `brew install supabase/tap/supabase` → `supabase start` → `supabase functions serve` → `supabase status`의 `API_URL`·`ANON_KEY`를 `.env`에 |

- 로컬 Docker에서 새 프로젝트를 만들려면 `supabase/functions/.env`에 `CHECKLY_CREATE_PROJECT_CODE=<아무 값>`을 둔다(git 제외).
- 팀 클라우드에서 새 프로젝트를 만들 때 필요한 생성 코드는 운영자에게 받는다.
- 패키징된 앱은 `.env`가 없으면 팀 클라우드에 접속한다. `CHECKLY_SUPABASE_URL=`(빈 값)으로 끌 수 있다.

## 2. 로그인 정보 쓰기

**renderer** — `window.electronAPI.auth` (계약: `src/app/ipc/auth/types.ts`)

```ts
const config = await window.electronAPI.auth.getConfig();   // { enabled } — false면 로컬 모드
const session = await window.electronAPI.auth.getSession(); // { userId, projectId, projectCode, nickname, role } | null
const off = window.electronAPI.auth.onSessionChange(s => { /* 로그인·로그아웃·프로젝트 변경 */ });
```

**main** — `src/app/ipc/auth/client.ts`

| 함수 | 용도 |
| --- | --- |
| `isSupabaseEnabled()` | 서버 설정이 있는지 |
| `getCurrentSession()` | 지금 로그인한 멤버(없으면 null). **팀 모드 = enabled && session** |
| `getSupabase()` | 그 멤버로 로그인된 클라이언트. RLS가 자기 프로젝트만 보여준다 |
| `onSessionChanged(listener)` | 세션이 바뀌면 프로젝트별 캐시를 비운다 |

오류 문장은 `src/app/ipc/auth/errors.ts`의 `toUserMessage`로 한국어로 바꾼다.

## 3. 엔드포인트 주소 쓰기

- 설정 → PROJECT의 **엔드포인트 × 환경** 표: `endpoints`(kind `web`|`api`), `environments`, `endpoint_urls`(base_url, spec_url).
- main에서는 `getSupabase().from("endpoint_urls").select(...)`로 읽는다(RLS가 프로젝트를 걸러 줌). renderer는 `auth.getProjectSettings()`.
- 빈 칸(행 없음)은 '미설정'이다. 내 기능에 필요한 쌍이 비어 있으면 화면에서 안내한다.
- 지금 고른 환경은 **개인·기능별로 로컬에 저장**한다(팀원 화면에 영향 없음).

## 4. 기능 데이터를 DB로 옮기기

예시 구현: API 테스트 — `src/app/api-testing/main/store.ts`(파일 모드) / `team-store.ts`(팀 모드). 같은 인터페이스 뒤에 두 저장소를 두고, 팀 모드일 때만 DB를 쓴다.

1. 테이블 추가: [supabase-common.md](supabase-common.md)의 "기능 테이블 규칙" 템플릿(`project_id`, `created_by`·`updated_by`, `touch()` 트리거, RLS `project_id = my_project_id()`).
2. 동시 수정: 읽은 `updated_at`을 조건으로 갱신하고 0행이면 충돌 안내.
3. Supabase가 설정된 앱에서 로그인하지 않았으면 웹 시나리오·API 테스트는 로그인 안내만 표시한다(파일 기능 제거: 웹 시나리오 2026-10-13, API 테스트 #33). Supabase 설정이 없는 개발·테스트 실행만 로컬 파일을 쓴다.
4. 무엇을 공유할지는 기능 담당자가 정한다. 캐시·PC 경로·개인 설정은 올리지 않는다.

## 5. DB 변경 절차 (직접 적용 + 증적 기록)

개발 속도를 위해 **팀 클라우드 DB는 각자 직접 바꾸고**, 바꾼 SQL은 **증적으로 `supabase/migrations/`에 남긴다.** 팀원은 Supabase 조직에 Developer로 초대돼 있다.

1. **직접 적용**: Supabase 대시보드 SQL Editor(또는 CLI)에서 SQL을 실행하고 앱으로 확인한다.
2. **증적 파일**: 같은 SQL을 `supabase/migrations/<YYYYMMDDhhmmss>_<이름>.sql`로 저장한다. 파일 맨 위에 한 줄 주석으로 누가·언제·왜를 적는다.
   ```sql
   -- hyewon 2026-10-12: 웹 시나리오 공유 테이블 추가(대시보드에서 적용함)
   ```
3. **다시 실행해도 안전하게 쓴다.** develop에 머지되면 Actions가 이 파일을 클라우드에 한 번 더 실행해 기록을 맞추므로, 이미 적용된 상태에서 실행해도 오류 없이 끝나야 한다.

   | 하려는 것 | 쓰는 형태 |
   | --- | --- |
   | 테이블 | `create table if not exists …` |
   | 컬럼 | `alter table … add column if not exists …` |
   | 인덱스 | `create index if not exists …` |
   | 함수 | `create or replace function …` |
   | 트리거 | `drop trigger if exists … on …;` 후 `create trigger …` |
   | RLS 정책 | `drop policy if exists "…" on …;` 후 `create policy …` |
   | RLS 켜기 | `alter table … enable row level security;` (반복해도 안전) |
   | 데이터 수정 | `update … where …`처럼 조건으로 한 번만 바뀌게. `insert`는 `on conflict do nothing` |
   | 삭제 | `drop … if exists …` |

4. **PR**: Actions가 빈 DB에 모든 파일을 적용·lint하고, 머지하면 적용될 파일을 미리 보여 준다(`db push --dry-run`).
5. **develop 머지**: Actions가 클라우드에 `db push`해 아직 기록되지 않은 파일을 실행하고 기록한다(이미 적용된 내용이면 바뀌는 것 없음). `supabase/**`가 바뀐 머지에서만 돈다.
6. 머지된 파일은 고치지 않는다. 바꿀 게 있으면 새 파일로 남긴다.

주의
- 직접 적용했는데 파일을 남기지 않으면 다른 팀원 로컬·새 환경에서 재현되지 않는다. **적용과 기록은 같은 날 PR까지.**
- 같은 테이블을 두 사람이 동시에 바꾸지 않는다. 공통 테이블(`projects`·`members`·`endpoints`·`environments`·`endpoint_urls`)은 운영자와 먼저 상의한다.
- 머지 후 반영이 실패하면 GitHub 저장소 Actions 탭의 `Supabase` 실행 기록(실패 시 GitHub 알림)에서 확인한다. 대개 다시 실행에 안전하지 않은 SQL이 원인이다 — 새 파일로 고친 뒤 다시 머지한다.
- 이 규칙 이전(2026-10-09까지)의 파일은 Actions로만 적용됐고 같은 기록을 갖고 있다.

## 6. 테스트

### 웹 시나리오 SQL을 SQL Editor에서 수동 적용할 때

먼저 SQL Editor가 의도한 Supabase 프로젝트인지 확인한다. 저장소의 팀 배포 대상 프로젝트 ID는 `aphxwkthjgoyrfnoljjh`다. `42P01: relation "public.projects" does not exist`는 공통 스키마부터 없는 상태이므로 웹 시나리오 SQL만으로 해결되지 않는다.

신규 DB라면 아래 마이그레이션 전체를 파일명 순서대로 적용한다.

1. `20261007000000_common_project.sql`
2. `20261007000100_project_settings.sql`
3. `20261007000200_api_testing.sql`
4. `20261009000000_api_share_secrets.sql`
5. `20261009000200_api_authorship.sql`
6. `20261013000000_web_scenarios.sql`
7. `20261014000000_web_scenario_runs.sql`

앞의 기존 마이그레이션 5개는 반복 실행용이 아니다. 이미 사용 중인 DB에서는 미적용 파일만 적용한다. SQL Editor의 수동 실행은 CLI 마이그레이션 이력을 자동 등록하지 않으므로 이후 Actions·CLI 배포 전 실제 적용 내역과 이력을 맞춰야 한다. 신규 Supabase 프로젝트에서 앱의 프로젝트 생성·가입까지 사용하려면 Edge Functions 배포와 앱 접속 환경 설정도 필요하다.

공통 프로젝트 테이블과 함수가 이미 설치된 팀 DB에서 다음 파일 전체를 순서대로 실행한다.

1. [`20261013000000_web_scenarios.sql`](../../supabase/migrations/20261013000000_web_scenarios.sql): 문서 테이블 `web_scenarios`와 작성 정보·RLS 생성.
2. [`20261014000000_web_scenario_runs.sql`](../../supabase/migrations/20261014000000_web_scenario_runs.sql): 시나리오·단계·실행 결과 테이블과 저장 RPC 생성.

두 번째 파일에서 `42P01: relation "public.web_scenarios" does not exist`가 나오면 첫 번째 파일이 해당 DB에 적용되지 않은 상태다. 첫 번째 파일을 실행한 뒤 두 번째 파일을 다시 실행한다. 두 파일 모두 반복 적용할 수 있다. CLI와 Actions는 파일명 순서대로 적용하지만 SQL Editor는 선행 파일을 자동 실행하지 않는다.

- Supabase 연동 테스트는 로컬 Supabase가 없으면 건너뛰게 쓴다(CI에는 Supabase가 없다). 예: `tests/auth/auth-supabase.test.ts`, `tests/api-testing/team-store.test.ts`.
- 키는 실행 중에 `supabase status -o env`에서 읽는다. 파일에 적지 않는다.
- 렌더러 화면 테스트는 `tests/fixtures/auth-stub.ts`로 `window.electronAPI.auth`를 흉내 낸다.

## 7. 하지 말 것

- `service_role`·`secret` 키, DB 비밀번호를 앱 코드·`.env.example`·커밋에 넣지 않는다(서버 함수 환경에만 있다).
- 직접 바꾼 DB를 증적 파일 없이 두지 않는다. 함수 배포는 Actions에 맡긴다(`supabase/functions/**` 머지 시 배포).
- 운영 계정·실서비스 토큰을 시나리오에 넣지 않는다. API 테스트의 "비밀값도 팀에 공유"가 켜져 있으면 팀 DB에 그대로 저장된다.

## 할 일

### 웹 시나리오 (담당: 팀원)
- [x] 웹 시나리오 본문·마커를 `web_scenarios`에 함께 저장. 영상·리포트·환경 선택은 로컬. `20261013000000_web_scenarios.sql` 추가(클라우드 적용은 별도 확인 필요).
- [x] 공통 `web` 엔드포인트·환경 선택 연결. 상대 경로의 기준 주소로 사용하며 개인 선택은 프로젝트별 localStorage에 저장.
- [x] `useScenarioState`의 기존 파일·좌표 로드 호출 제거. 로그인 후 DB 목록만 조회하고 실패 시 한국어 오류를 표시한다.
- [x] 시나리오·단계 정규화, UUID 마커, 소프트 삭제, 실행 스냅샷·단계 결과 저장·기록 복원 연결. `20261014000000_web_scenario_runs.sql` 추가.
- [ ] 새 웹 시나리오 마이그레이션을 팀 클라우드에 적용하고 실제 계정으로 CRUD·RLS·충돌 검증 (현재 로컬 Docker/Supabase 미실행).

### 폼 자동 완성 (담당: 팀원)
- [ ] 공유할 데이터 정하기 → 테이블 추가 요청
- [ ] 엔드포인트 `web` 주소·`api` 스웨거(`spec_url`) 연결, 기능 안의 주소·스웨거 저장 정리

### 공통 · API 테스트 (담당: 공통 통합)
- [x] 관리자가 팀원 비밀번호 초기화(가상 이메일이라 메일 대신 관리자가 설정 > 멤버에서 재설정 코드 발급 → 로그인 화면 "비밀번호 찾기"). `20261020000000_auth_password_resets.sql`, `issue-reset-code`·`reset-password` 함수 추가(클라우드 적용·배포는 별도 확인 필요)
- [ ] 관리자 본인의 비밀번호 찾기(대신 발급할 사람이 없어 지금은 운영자 문의 안내만 한다)
- [ ] 관리자 위임, 프로젝트 나가기·삭제(프로젝트 삭제 시 auth 사용자도 정리)
- [ ] API 테스트만 쓰는 멤버가 내보내졌을 때 바로 로그아웃
- [ ] 로컬 패키징 시 `tree-sitter` 네이티브 재빌드 오류(C++20) — CI 릴리스 빌드에서 재현되는지 확인
- [ ] 위 두 기능이 연결되면 설정의 엔드포인트 안내 문구에서 "연결 예정" 제거

### 운영
- [ ] GitHub 저장소 secret `SUPABASE_ACCESS_TOKEN` 등록(Supabase 대시보드 > Account > Access Tokens), develop 브랜치 보호(PR 리뷰 필수)
- [ ] Supabase 대시보드 계정 2단계 인증(MFA)
- [ ] 무료 플랜: 7일 미사용 시 일시 정지, 자동 백업 없음 — 사용량이 늘면 Pro 검토
