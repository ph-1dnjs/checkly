# AGENTS.md

## 먼저 읽을 문서
- 코드 규칙: docs/03-conventions/README.md
- 구조: docs/02-architecture/README.md

## 팀 프로젝트 · Supabase 작업 시
로그인, 프로젝트·멤버, 엔드포인트 × 환경, 기능 데이터의 팀 공유(DB),
`supabase/**`를 건드리기 전에 반드시 읽는다:
- docs/02-architecture/supabase-guide.md — 맞출 규칙, DB 변경 절차, 할 일
- docs/02-architecture/supabase-common.md — 테이블·RLS·화면 흐름 설계

지킬 것
- 팀 모드(로그인)일 때만 DB를 쓴다. Supabase가 설정된 앱에서 로그인하지 않았으면 웹 시나리오·API 테스트는 로그인 안내만 보여 준다. Supabase 설정이 없는 개발·테스트 실행만 로컬 파일을 쓴다.
- DB 변경은 다시 실행해도 안전한 SQL로 `supabase/migrations/`에 증적을 남긴다.
- service_role·secret 키, DB 비밀번호, 프로젝트 생성 코드를 코드·커밋에 넣지 않는다.
- 공통 테이블(projects·members·endpoints·environments·endpoint_urls)은 바꾸지 않는다. 필요하면 운영자와 상의한다.
