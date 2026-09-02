# [엣지 케이스] 시나리오 실행

| 상황 | 현재 동작 | 영향 / 다음 행동 |
| --- | --- | --- |
| 기본 URL 접속 실패 | failed log·리포트 | 다음 시나리오 계속 |
| locator/timeout 실패 | 현재 시나리오 failed | 실패 message 확인 |
| 조건 미충족 | 해당 단계 skip | 실패 수 증가 없음 |
| upload path 없음 | 명시 오류로 failed | 파일 marker 수정 |
| popup 열림 | 활성 Page로 제어, 닫히면 원 Page | 다중 popup 복잡성 주의 |
| manualFill 취소 | cancelled result | 큐 중단 |
| manualControl/result 5분 초과 | reason 포함 failed | 다음 시나리오 계속 |
| 실패 사유 빈 manualResult | UI 실패 버튼 disabled | 사유 입력 |
| preview 캡처 실패 | 오류 무시 | 실행 계속 |
| 실행 중 화면 이동 | background 유지 | 알림으로 복귀 |
| 중지 1회 | 3.5초 확인만 표시 | 두 번째 클릭 필요 |
| 시나리오 실패 | 큐는 계속 | 묶음 최종 failed |
| 전체 취소 | record·영상 병합 생략 | 시나리오별 산출물 일부는 존재 가능 |
| video finalize 실패 | null event | 실행 결과는 유지 |
| ffmpeg 없음·concat 실패 | 전체 영상 토스트 | 단일 영상 사용 |
| 허용되지 않은 video path | reject | runs 경로만 허용 |
| 동일 파일명 다운로드 | `copyFile`로 대상 덮어쓸 수 있음 | Downloads 확인 |
| 창 분리 버튼 | 로그·토스트만 표시 | 실제 window 생성 안 됨 |
| UI의 headed 인상 | main은 항상 headless | preview 제어가 실제 방식 |

