# 예외 처리·제한·검증 항목

> **범위**: 실제 복구 분기, 취소·화면 상태 차이, 미보장 동작. 향후 개선과 현재 정책을 구분합니다.

| 상황 | 현재 처리 | 영향·다음 확인 |
| --- | --- | --- |
| 실행 배열 없음 | 안내 모달, 시작하지 않음 | 원문 작성 또는 파일 선택 |
| URL 오류·브라우저/접속 실패 | main catch에서 failed 로그·리포트 | 다음 시나리오 진행; 사전 URL 검증 없음 |
| 단계가 0개 | 기본 URL 접속 성공 시 passed 가능 | 최소 단계 수 정책 없음 |
| locator·입력·업로드·텍스트 timeout | 현재 시나리오 failed, 나머지 단계 중단 | 다음 시나리오 계속; 대상과 마지막 로그 확인 |
| 조건 텍스트 없음 | skip·캡처·진행 갱신 | 전부 skip이어도 시나리오는 passed 가능 |
| 클릭 1회 실패 | force click 재시도 | 전체 시나리오 자동 재시도는 없음 |
| manualFill 응답 없음 | 시간 제한 없는 대기 | 제출 또는 취소 필요 |
| manualControl/result 300초 초과 | 사유 포함 failed | 다음 시나리오 계속; renderer 수동 UI를 자동 지우는 별도 이벤트는 없음 |
| 수동 실패 사유 공백 | UI 버튼 비활성, main은 기본 사유 지원 | UI 검증과 IPC 계약 구분 |
| 큐 실행 중 일반 중지 | sequence 무효화, UI 취소 표시, worker 종료 요청 | 종료 sequence 검사에서 기록·병합 생략; 이미 생성된 파일 유지 |
| 영상 병합 중 중지·새 실행 | 이미 recordRun 이후이며 병합 후 sequence 재검사 없음; qa:cancel은 ffmpeg를 중단하지 않음 | 기존 기록·병합 작업이 남고 늦은 완료가 새 UI 상태를 덮어쓸 수 있음 |
| 자동 액션 도중 취소 | 브라우저 종료 예외가 일반 catch로 들어갈 수 있음 | main 리포트는 failed인데 renderer는 cancelled일 수 있음 |
| 취소 직후 잔여 이벤트 | 이벤트에 sequence 필터 없음 | 늦은 progress/preview/video가 상태에 반영될 수 있음 |
| 중지·다음 실행 | 수동 상태 전체를 지우는 공통 정리 없음 | 이전 입력/제어/판정 UI가 남는 경우를 확인해야 함 |
| 실행 중 다시 시작 | beginRuns의 running 가드 없음 | 하단은 중지로 바뀌지만 편집기 바로 실행 등의 중복 호출 차단은 보장하지 않음 |
| qa:start IPC reject | renderer catch가 failed 결과 추가; catch에는 sequence 검사 없음 | 취소·새 실행 이후의 이전 reject도 결과에 끼어들 수 있음 |
| 리포트 쓰기 실패 | catch에서 failed 리포트 재시도 가능; 다시 실패하면 reject | 정상 동작 완료도 실패로 보일 수 있음 |
| finishQaWorker IPC reject | 종료 await를 감싸는 catch/finally 없음 | running 종료/기록/병합 단계에 도달하지 못할 수 있음 |
| 캡처 오류 | 무시 | 실행은 계속, 해당 이미지 없거나 이전 이미지 유지 |
| 미리보기 토글 | UI 표시는 즉시 변경; 실행 묶음의 비동기 루프는 beginRuns 호출 당시 livePreview를 캡처 | main preview 옵션 변경은 다음 실행 묶음부터 반영. 현재 묶음의 다음 시나리오도 시작 당시 값을 사용 |
| 화면 표시를 끈 manualControl | main 캡처는 계속되지만 직접 제어 영역은 livePreview 조건 아래 렌더링 | 실행 화면에서 화면 표시를 다시 켜야 이미지·계속/실패 버튼을 사용할 수 있음 |
| 영상 이동·finalize 실패 | qa:run-video null | 테스트 결과는 유지; 단일/전체 영상 누락 가능 |
| ffmpeg 부재·병합 실패 | 전체 영상 실패 토스트 | 기존 결과 기록·단일 영상 사용 가능 |
| 허용 디렉터리 밖 영상 | reject | runs 바로 아래 경로만 허용 |
| 동명 영상·동명 다운로드 | 초 단위 단일 영상명, copyFile 덮어쓰기 | 충돌 방지용 고유 ID/사본 번호 정책 없음 |
| 여러 파일의 시나리오 실행 | 각 파일을 별도 파싱하면 scenario-0 등이 중복되고 실행 전달 시 ID를 재부여하지 않음 | 단계 이미지·결과 find·영상 매칭이 ID 기준이어서 다른 파일 결과와 혼동될 수 있음 |
| 팝업에서 후속 자동 액션 기대 | 자동 액션은 원래 page 참조 | 직접 제어와 자동 실행 대상이 다름 |
| 여러 팝업·시나리오 | context page listener가 시나리오마다 추가됨 | 복잡한 팝업 수명·listener 정리 보장 없음 |
| 실행 실패/취소 후 상단 상태 | RunPage는 수동 상태/진행률로 WAITING/RUNNING/FAILED/PASSED/IDLE 계산 | 미완료 실패가 IDLE, 잔여 수동 상태가 WAITING으로 표시될 수 있음. 개별 결과·로그 함께 확인 |
| 화면 이탈 | 큐는 계속 | 입력·직접 제어는 실행 화면 복귀 필요; manualResult는 전역 모달 |
| 창 분리·headed | 창 분리는 로그/토스트뿐, headed 미사용 | 실제 Chromium은 headless |

## 정책 변경 전에 결정할 사항

| 결정할 사항 | 현재 동작 | 영향 받는 코드 |
| --- | --- | --- |
| 실행 간 세션 격리 | 묶음 내 BrowserContext 공유 | qaExecution |
| 취소 완료 시점과 상태 일관성 | UI 선행 종료, 이벤트·reject·병합 완료 최신성 검사 불완전 | useRunOrchestration, qaExecution, video |
| 수동 대기 만료·이탈 처리 | manualFill 무제한, 다른 수동 단계 300초; UI 공통 정리 없음 | useRunOrchestration, RunPage, App |
| 산출물 보존·민감정보 범위 | 디스크 자동 삭제·영상 마스킹 없음 | reports, video, qaExecution |

위 표는 결정이 필요한 보완점이며 구현된 보장으로 취급하지 않습니다.

## 변경 시 검증 기준

1. 두 시나리오를 순차 실행해 컨텍스트 공유와 새 Page 생성, 실패 후 다음 항목 진행을 확인합니다.
2. 각 자동 액션, 조건 skip, 클릭 순번/CSS/iframe, select label/value fallback과 timeout을 확인합니다.
3. 세 수동 액션의 정상 응답·실패·취소·시간 초과 및 화면 이동을 확인합니다. manualFill에는 시간 초과가 없습니다.
4. viewport 변경 후 다음 시나리오·팝업에도 적용되는지, 직접 제어 좌표가 실제 캡처 크기와 맞는지 확인합니다.
5. 자동 단계·수동 대기·큐 사이 취소와 즉시 재실행에서 잔여 이벤트·수동 UI·파일 결과를 확인합니다.
6. 단일/전체 영상, 리포트 쓰기 오류, 캡처 실패를 각각 구분하고 재시작 후 기록은 사라져도 파일은 남는지 확인합니다.

현재 편집기 mock E2E나 API 테스트 전용 테스트만으로 이 native 브라우저 실행 정책이 검증되었다고 간주하지 않습니다. 이 문서 갱신은 소스 대조이며 위 실행 시나리오의 자동/수동 실측 완료를 뜻하지 않습니다.
