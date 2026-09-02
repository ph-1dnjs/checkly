# [API 연동] 시나리오 편집

| IPC | 호출 시점 | 용도 |
| --- | --- | --- |
| `scenario:load` / `save` | 앱 초기화·저장 | 기본 Markdown 보관 |
| `scenario:import-file` / `export-file` | 파일 버튼 | Markdown 파일 선택·기록 |
| `scenario:save-imported-file` | 불러온 파일 저장 | 기존 파일 덮어쓰기 |
| `marker-positions:load` / `save` | 초기화·변경 | 마커 좌표 보관 |
| `qa:inspect` | 마커 모드 진입 | 대상 요소 연결 검사 |

모든 파일 경로 선택은 main 프로세스의 native dialog에서 수행합니다.

