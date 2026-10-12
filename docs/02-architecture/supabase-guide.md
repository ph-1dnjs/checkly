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
| 팀 모드 / 로컬 모드 | 로그인했을 때만 DB를 쓰고, 로그인하지 않으면 지금 로컬 동작을 그대로 둔다 |
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
| 클라우드를 건드리지 않고 개발 | Docker + `brew install supabase/tap/supabase` → `supabase start` → `supabase functions serve` → `supabase status`의 `API_URL`·`ANON_KEY`를 `.env`에 |

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
3. 로그인 안 했을 때는 기존 로컬 파일 동작을 그대로 둔다.
4. 무엇을 공유할지는 기능 담당자가 정한다. 캐시·PC 경로·개인 설정은 올리지 않는다.

## 5. 마이그레이션 절차

1. `supabase/migrations/<YYYYMMDDhhmmss>_<이름>.sql` 추가
2. 로컬에서 `supabase migration up`(데이터 유지) → 테스트. `supabase db reset`은 로컬 데이터가 지워진다.
3. PR을 올린다. GitHub Actions(`.github/workflows/supabase.yml`)가 빈 DB에 마이그레이션을 모두 적용하고 lint해 SQL 오류를 검사한다.
4. **develop에 머지되면 Actions가 팀 클라우드에 자동 반영한다**(`db push` + Edge Function 배포). 직접 `db push`하지 않는다.
5. 이미 develop에 들어간 마이그레이션 파일은 고치지 않는다. 바꿀 게 있으면 새 파일을 만든다. 머지 직전에 파일 이름의 시간이 develop의 마지막 파일보다 뒤인지 확인한다.
6. SQL은 PR 리뷰에서 꼭 본다. 클라우드에 한 번 반영되면 되돌리려면 반대 작업 마이그레이션이 필요하다.

## 6. 테스트

- Supabase 연동 테스트는 로컬 Supabase가 없으면 건너뛰게 쓴다(CI에는 Supabase가 없다). 예: `tests/auth/auth-supabase.test.ts`, `tests/api-testing/team-store.test.ts`.
- 키는 실행 중에 `supabase status -o env`에서 읽는다. 파일에 적지 않는다.
- 렌더러 화면 테스트는 `tests/fixtures/auth-stub.ts`로 `window.electronAPI.auth`를 흉내 낸다.

## 7. 하지 말 것

- `service_role`·`secret` 키, DB 비밀번호를 앱 코드·`.env.example`·커밋에 넣지 않는다(서버 함수 환경에만 있다).
- 클라우드에 직접 `db push`·함수 배포를 하지 않는다(develop 머지 → Actions가 반영).
- 운영 계정·실서비스 토큰을 시나리오에 넣지 않는다. API 테스트의 "비밀값도 팀에 공유"가 켜져 있으면 팀 DB에 그대로 저장된다.

## 할 일

### 웹 시나리오 (담당: 팀원)
- [ ] 공유할 데이터 정하기(로컬에만 둘 것과 구분) → 테이블 추가 요청
- [ ] 엔드포인트 `web` 주소·환경 선택 연결("모든 기능이 맞출 것" 기준)
- [ ] 팀 모드로 다시 켰을 때 "저장된 시나리오를 불러오지 못했습니다" 알림 원인 확인 (`useScenarioState.ts`)

### 폼 자동 완성 (담당: 팀원)
- [ ] 공유할 데이터 정하기 → 테이블 추가 요청
- [ ] 엔드포인트 `web` 주소·`api` 스웨거(`spec_url`) 연결, 기능 안의 주소·스웨거 저장 정리

### 공통 · API 테스트 (담당: 공통 통합)
- [ ] 관리자가 팀원 비밀번호 초기화(가상 이메일이라 비밀번호 찾기 메일이 없다)
- [ ] 관리자 위임, 프로젝트 나가기·삭제(프로젝트 삭제 시 auth 사용자도 정리)
- [ ] API 테스트만 쓰는 멤버가 내보내졌을 때 바로 로그아웃
- [ ] 로컬 패키징 시 `tree-sitter` 네이티브 재빌드 오류(C++20) — CI 릴리스 빌드에서 재현되는지 확인
- [ ] 위 두 기능이 연결되면 설정의 엔드포인트 안내 문구에서 "연결 예정" 제거

### 운영
- [ ] GitHub 저장소 secret `SUPABASE_ACCESS_TOKEN` 등록(Supabase 대시보드 > Account > Access Tokens), develop 브랜치 보호(PR 리뷰 필수)
- [ ] Supabase 대시보드 계정 2단계 인증(MFA)
- [ ] 무료 플랜: 7일 미사용 시 일시 정지, 자동 백업 없음 — 사용량이 늘면 Pro 검토
