# [사용자 흐름] 설정

```mermaid
flowchart TD
  A[설정 진입] --> B[현재 기본 URL과 고정 환경 표시]
  B --> C{토글 변경}
  C --> D[SettingsPage 로컬 state 변경]
  D --> E{화면 이탈}
  E --> F[state 소멸]
```

| 사용자 액션 | 화면 동작 | 실제 시스템 영향 |
| --- | --- | --- |
| 브라우저 변경 | 버튼 클릭 handler 없음 | 없음 |
| 영상 보관 토글 | switch UI 변경 | 녹화·삭제 정책 변화 없음 |
| 실패 알림 토글 | switch UI 변경 | 알림 전송 없음 |
| Slack 토글 | switch UI 변경 | OAuth·채널·메시지 없음 |

