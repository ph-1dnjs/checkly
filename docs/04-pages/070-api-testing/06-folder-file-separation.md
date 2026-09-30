# API 테스트 폴더·파일 분리 기준

폴더는 데이터·사용자 행동·화면 조합의 책임으로 나누고, 같은 책임 안에서 파일 역할을 구분합니다. 파일 길이나 재사용 횟수만으로 레이어를 정하지 않습니다. API 테스트에 적용한 기준이며, 다른 화면을 일괄 이동하거나 이름을 통일하지 않습니다.

## 레이어와 프로세스 경계

```text
renderer/app → pages → widgets → features → entities → shared
```

- `entities`: API 시나리오 데이터의 표시·계산, 최근 실행 상태.
- `features`: 시나리오 편집, AI 작성, 프로젝트·명세·변수·인증 설정, 실행 입력 제출 같은 사용자 행동.
- `pages`: 프로젝트·환경·탭·URL 상태와 기능을 연결하는 화면 전체 흐름, Swagger 화면 어댑터.
- `widgets`: 여러 화면에서 사용할 기능 조합이 실제로 생길 때 사용합니다. 이번 분리에서는 새 widget을 만들지 않습니다.
- `shared`: 업무 의미가 없는 입력·정렬 UI, 공통 실행 버튼 계약과 훅. API 전용 데이터 표현 UI는 entity에 둡니다.

이 레이어는 React renderer의 구조입니다. Electron main의 파일 저장·HTTP 실행은 `src/app/api-testing/main`, renderer와 main이 공유하는 계약은 `src/app/api-testing/shared`에 유지합니다. renderer는 main을 직접 import하지 않고 전달받은 브리지를 사용합니다.

## 실제 파일 배치

```text
src/renderer/
├── pages/api-testing/
│   ├── ApiTestingPage.tsx
│   ├── ui/                 # 문서·시나리오·스위트 조합, Provider 연결, CSS
│   ├── lib/                # URL·Swagger deep-link·요청 어댑터
│   └── model/              # Swagger 타입·외부 모듈 선언
├── features/api-testing/
│   ├── edit-scenario/      # ui, model, lib, index.ts
│   ├── author-scenarios/   # ui, index.ts
│   ├── configure-project/ # ui, index.ts
│   ├── configure-spec/    # ui, index.ts
│   ├── configure-globals/ # ui, context, index.ts
│   ├── configure-request-auth/
│   └── submit-run-input/
├── entities/api-testing/
│   ├── ui/                 # 요약·결과·트리·JSON/YAML 표현
│   ├── lib/                # 응답 필드·설정 요약·전역변수 생산자 계산
│   ├── model/              # 최근 실행 상태·상태 표시 이름
│   └── index.ts
└── shared/
    ├── hooks/useRunAction.ts
    ├── model/run-action.ts
    └── ui/                 # DraftFields·SortableList 및 기존 공통 UI
```

`ApiDocumentation`, `ScenarioPanel`, `SuitePanel`은 여러 기능과 실행 결과를 조합하므로 page UI에 둡니다. `ScenarioBuilder`·`SimpleStep`은 요청값과 연결을 편집하는 하나의 기능입니다. `ScenarioStepSummary`·`ScenarioRunViews`는 데이터를 표시하고 동작은 콜백으로 전달하므로 entity UI에 둡니다. `SidebarMetadataFields`는 분류값을 편집해 콜백으로 반환하며 저장 요청은 상위가 결정합니다.

## slice 안의 역할

| 폴더 | 역할 |
| --- | --- |
| `ui` | 컴포넌트·폼·모달·화면 섹션 |
| `model` | 해당 책임의 타입·상수·상태 모델 |
| `lib` | 계산·변환 등 보조 함수 |
| `context` | 해당 기능·데이터가 공유하는 상태와 Provider |
| `hooks` | React 상태·효과를 묶은 훅 |
| `api` | 필요할 때 요청 함수를 분리. renderer에 직접 HTTP·IPC 전송 계층을 새로 만들지 않음 |
| `index.ts` | 외부 사용처가 실제로 필요한 공개 항목 |

필요한 폴더만 만듭니다. 짧은 props 타입과 해당 컴포넌트만 사용하는 이벤트 핸들러는 같은 파일에 둡니다. `response-global-name`은 응답에서 저장할 변수명을 제안하는 편집 기능의 lib이고, `response-fields`는 명세를 읽는 entity의 lib입니다.

## import와 기능 연결

- 기존 프로젝트 관례대로 상대 import를 사용합니다. API 테스트의 구조 분리를 위해 전역 path alias나 빌드 설정을 추가하지 않습니다.
- 다른 entity·feature slice를 사용할 때는 필요한 항목만 공개한 `index.ts`를 사용합니다. 같은 slice 내부는 구체적인 파일을 참조하고 자기 barrel을 다시 import하지 않습니다.
- feature끼리 직접 import하지 않습니다. 여러 기능이 협력하면 page에서 데이터를 전달하거나 콜백으로 연결합니다.
- 전역변수 관리 feature의 `open`·`revision`은 page에서 편집 기능의 `onConfigureGlobal`·`globalRevision`에 전달합니다. `GlobalVariableSetupLink`는 콜백만 호출합니다.
- `ApiTestingProviders`가 전역변수 저장 revision을 entity의 `SensitiveValuesProvider`에 전달합니다. JSON 표시 코드가 변수 편집 feature를 참조하지 않습니다.
- 공통 Dock은 `shared/model/run-action`의 계약을 사용하므로 App이 특정 페이지의 내부 훅 타입에 의존하지 않습니다.
- 순수 함수 테스트는 UI까지 불러오지 않도록 실제 lib/model 파일을 직접 import할 수 있습니다. 테스트는 기존 `tests/api-testing` 실행 위치에 유지합니다.

## 검증

`npm run test:api`의 `module-boundaries.test.ts`는 API 테스트 관련 renderer의 상향 의존성·feature 간 직접 import·공개 API 우회·main 코드 참조·순환 참조를 검사합니다. 타입 import와 동적 import도 포함합니다. 기존 다른 화면 전체를 새 규칙으로 강제하지 않습니다.

타입 검사(`npx tsc --noEmit --types node,electron`), 빌드(`npm run build`), 브라우저 테스트(`npm test`)도 함께 확인합니다. 브라우저 회귀 테스트는 환경 전환 중 초안 보존, 명세 로딩·실패 중 이전 환경 명세 미표시, 작성 중인 배열·본문 JSON 유지, 전역변수 설정 후 편집·요약·인증 선택 갱신을 검증합니다.
