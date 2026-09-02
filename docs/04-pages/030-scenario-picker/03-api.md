# [API 연동] 시나리오 선택

| IPC | 용도 | 실패 시 |
| --- | --- | --- |
| `scenario:list-folder` | 저장된 폴더의 Markdown 목록 조회 | 빈 목록 반환 |
| `scenario:choose-folder` | native 폴더 선택 후 경로 저장 | 취소 시 기존 목록 유지 |
| `scenario:read-file` | 선택 파일의 Markdown 읽기 | `null` 반환 |

목록 조회는 경로 오류나 읽기 오류를 내부에서 처리하여 `{ folderPath: null, files: [] }`를 반환합니다.

