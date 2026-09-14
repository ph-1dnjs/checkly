# [개요] API 테스트

## 구현 범위

프로젝트마다 여러 서버와 환경을 설정합니다. API 문서, 시나리오, AI 작성 도우미 탭을 제공하며 전역변수는 프로젝트·환경 단위로 공유합니다. 개별 API 요청과 시나리오 실행은 동일한 HTTP 실행 코어를 사용합니다.

API 문서는 공식 Swagger UI에 저장된 명세를 전달합니다. 태그 접기·펼치기, 요청 편집, 응답 명세 및 실시간 응답 표시를 지원합니다. 검색은 태그·메서드·경로·전체 URL·operationId·summary·description을 대상으로 합니다. 하단 전체 Schemas 목록은 숨기고 개별 요청·응답의 스키마는 표시합니다.

현재 Swagger 화면에는 별도 tagsSorter/operationsSorter를 지정하지 않습니다. 이전 목록용 `documentation-order.ts`의 선언 태그 → 미선언 이름순, 경로 → 메서드 정렬 규칙을 현재 Swagger 화면의 계약으로 간주하지 않습니다.

태그·엔드포인트 펼침 상태는 URL hash와 연결합니다. hash에는 프로젝트·환경이 포함되지 않으므로 해당 명세가 선택되어 있어야 위치를 찾을 수 있습니다. 앱 내부 hash 이동과 외부에서 앱을 여는 OS 딥링크는 별개이며 후자는 미구현입니다.

## 코드 경계

화면은 기존 페이지 구조인 `src/renderer/pages/api-testing/`에 둡니다. 웹 개발 진입점과 웹 브리지는 `src/renderer/app/api-web/`, 공통 UI는 `src/renderer/shared/ui/`에 둡니다. 실행·저장 서비스와 계약은 `src/app/api-testing/main/`, `shared/`에 유지합니다. 별도 npm 패키지는 없습니다. renderer는 main을 직접 import하지 않고 브리지를 사용합니다. shared 모델은 Node.js·Electron·DOM에 의존하지 않습니다. Electron 빌드는 main/shared를, Vite는 renderer를 처리합니다.

기존 공통 Dock과 Popover를 사용합니다. `useRunAction`은 현재 API 또는 시나리오 실행을 Dock에 연결합니다. 공통 `ProgressBar`는 API 시나리오 결과 영역의 실행 중 상태에, `LoadingSpinner`는 명세 조회에 사용합니다. 단계별 진행 이벤트가 없으므로 시나리오 로딩바는 퍼센트를 표시하지 않습니다. 실행 중 입력이 필요한 API 단계는 실행을 잠시 멈추고 결과 영역 위에 입력 모달을 표시하며, 제출하면 같은 실행을 이어갑니다. 시나리오의 `valueBindings`는 전체 단계의 요청·응답 출처를 `vars.*`로 연결하고, 실행 시에는 이미 완료된 출처만 해석합니다.

## 저장과 수명

| 데이터 | 앱 | 웹 개발 모드 |
| --- | --- | --- |
| 저장 루트 | Electron userData의 `api-testing/` | 저장소의 `.local/api-testing-web/` |
| 프로젝트·서버·환경 | `projects.json` | 동일 형식 |
| 명세 | `catalog-{projectId}-{environmentId}-{serverId}.json` | 동일 형식 |
| 명세 URL·동기화·계정 정보 | `spec-source-…json` | 계정 기억 제외 |
| 시나리오 | `scenarios-{projectId}.json` | 동일 형식 |
| 전역변수·API 인증 연결 | 프로세스 메모리 | 개발 서버 메모리 |
| 실행 입력·결과 | 일시적 화면/실행 상태 | 일시적 화면/실행 상태 |

프로젝트와 명세는 재시작 후 복원됩니다. 앱과 웹 데이터는 자동 동기화하지 않습니다. 파일은 임시 파일 기록 후 rename으로 교체합니다. 시나리오에는 YAML 원문·서버 매핑·수정 시각·초안 여부가 저장됩니다.

문서 계정 기억은 사용자가 선택하고 OS 보안 저장을 사용할 수 있을 때만 비밀번호를 암호화해 저장합니다. 실제 API용 토큰과 전역변수는 재시작하면 사라집니다.

## 응답과 외부 전달

API 문서의 `executeLive`는 JSON·텍스트·헤더 원문을 일시적으로 표시하며 자동 저장하지 않습니다. `execute`와 시나리오 결과는 마스킹 계약을 유지합니다. 리포트·이력·AI 내보내기에 원문 응답을 그대로 재사용하지 않습니다. 리포트 저장과 실행 이력 화면은 아직 없습니다. 값 출처 연결은 실행 메모리에서만 실제 값을 전달하며 YAML에는 출처와 변수 이름만 기록합니다.
