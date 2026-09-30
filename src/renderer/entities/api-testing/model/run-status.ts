export const runStatusName = (status: string) => ({ passed: "통과", failed: "실패", error: "오류", blocked: "설정 필요", cancelled: "취소", skipped: "건너뜀" })[status as "passed"] ?? status;
