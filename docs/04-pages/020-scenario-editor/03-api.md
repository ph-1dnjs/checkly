# IPC·데이터·저장 정책

웹 시나리오는 로그인한 팀 프로젝트의 Supabase DB만 사용한다. 렌더러에는 세션 토큰을 노출하지 않는다.

| bridge / IPC | 입력 | 결과 |
| --- | --- | --- |
| `webScenarios.list` / `web-scenario:list` | 없음 | 현재 프로젝트 문서 목록(최신 수정순), 본문·마커·작성 정보 |
| `webScenarios.save` / `web-scenario:save` | `title`, `markdown`, `positions`, 선택적 `id`, `expectedUpdatedAt` | 저장된 문서와 새 `updatedAt` |
| `webScenarios.remove` / `web-scenario:remove` | ID, 읽은 `updatedAt` | 성공 또는 충돌 오류 |
| `selectUploadFile` / `qa:select-upload-file` | 없음 | 업로드할 파일 경로 또는 null |
| `auth.getProjectSettings` | 없음 | 공통 엔드포인트·환경·주소 |

구현: `src/app/ipc/web-scenario/{index,bridge,store,types}.ts`.

`web_scenarios`의 한 행은 Markdown 문서 하나다. 기존 문법과 템플릿 복제를 지원하기 위해 여러 시나리오 블록을 포함할 수 있고, 목록 제목은 첫 블록 제목이다. 문서 ID는 DB UUID로서 제목 변경 후에도 유지된다. 블록은 parser의 문서 ID+블록 순서로 실행 목록에서 구분한다.

본문과 마커 JSON은 한 insert/update로 저장한다. 마커 자동 저장은 없다. 수정·삭제는 `project_id`, `id`, `updated_at`을 모두 조건으로 하며 0행이면 충돌이다. 읽은 버전은 목록 새로고침만으로 갱신하지 않고, 문서를 다시 열 때 갱신한다. 에디터 새로고침은 미저장 확인 후 열린 문서도 재조회 결과로 교체한다.

`project_id`는 main의 로그인 세션에서 정한다. RLS는 `my_project_id()`로 격리하고 `created_by`/`updated_by`는 DB 트리거가 채운다. 목록의 작성자 이름은 프로젝트 멤버에서 조회하고 탈퇴한 사용자는 `(나간 멤버)`로 표시한다. 세션 캐시는 두지 않으며 로그아웃은 Workspace를 제거하고 프로젝트 전환은 앱을 다시 불러온다.

비로그인 상태는 로그인 안내만 표시한다. 기존 폴더 연결·시나리오 파일 불러오기·내보내기·다른 이름 저장 IPC는 삭제됐다. 기존 사용자 파일은 삭제·이전하지 않는다. 영상·실행 리포트는 계속 로컬에 남는다.

선택한 웹 엔드포인트·환경은 `web-scenario-environment:<projectId>` localStorage에 개인별 저장한다. 상대 `url:`은 선택한 기준 주소로 해석하고 절대 URL은 유지한다. 주소 미설정이면 실행을 차단하고 설정 안내를 표시한다.

업로드 단계의 PC 파일 경로는 공유 전 빈 값으로 분리한다. 원래 값은 `web-scenario-uploads:<projectId>:<documentId>` localStorage에 저장해 같은 PC에서 복원하며 다른 PC에서는 파일을 다시 선택해야 한다. 파일 자체를 업로드하거나 복사하지 않는다.
