# [IPC 연동] 시나리오 선택

| IPC | 입력 | 출력 | 실패·취소 |
| --- | --- | --- | --- |
| `scenario:list-folder` | 없음 | folderPath, file 목록 | 경로·읽기 오류면 null+빈 목록 |
| `scenario:choose-folder` | 없음 | 선택 후 목록 | 취소면 기존 저장 폴더 목록 |
| `scenario:read-file` | 절대 path | 원문 또는 null | read 오류면 null |

file 목록은 name, path, ISO updatedAt을 포함합니다. renderer는 목록의 각 파일을 병렬로 읽어 parser 결과를 cache합니다.

