# [IPC 연동] 시나리오 편집

| IPC | 시점 | 입력·출력 | 저장·효과 |
| --- | --- | --- | --- |
| `scenario:load` | App mount | 원문 또는 null | userData 기본 원문 |
| `scenario:save` | import·save·marker 저장 | Markdown → void | 기본 원문 |
| `scenario:import-file` | 불러오기 | 없음 → 원문+path/null | 활성 외부 경로 설정 |
| `scenario:save-imported-file` | 활성 파일 저장 | Markdown → path/null | 원본 덮어쓰기 |
| `scenario:export-file` | 새 파일 저장 | Markdown → path/null | 새 활성 파일 |
| `qa:select-upload-file` | upload marker 파일 선택 | 없음 → path/null | marker value만 변경 |
| `marker-positions:load/save` | mount·store 변경 | JSON string | 좌표·메타 저장 |
| `qa:inspect` | marker 모드 진입 | Scenario → id/connected | headless 기본 URL 검사 |

marker store 저장 effect는 초기 state와 load 이후 state 모두에서 실행될 수 있으므로 변경 시 effect 순서를 확인합니다.

