import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "../../src/app/ipc/ai-tc/ai";

test("빈 등록 화면에서도 준비 데이터와 파일을 실행 모델에 전달하고 검증용 공란을 보존한다", () => {
  const prompt = buildPrompt({
    tc: {
      id: "BOS-IN-001", pre: "D0: 운영 기간과 썸네일을 입력하고 제목 공란을 검증한다",
      steps: ["제목을 비운다"], expected: [{ id: "E1", text: "제목 오류와 등록 비활성" }],
      data: [{ label: "정상 준비용 운영 기간", value: "2026-11-10 10:00 ~ 2026-11-17 18:00" }],
      files: ["thumbnail_570x285.png"],
    },
    url: "https://example.com/promotion/new", title: "등록", snapshot: 'textbox "시작일시"\nbutton "등록하기" [disabled]',
    history: [], sharedContext: true,
  });
  assert.match(prompt, /직접 구성한 뒤 테스트를 진행/);
  assert.match(prompt, /검증하려는 공란·오류값·미선택 상태는 정상값으로 보정하지 않는다/);
  assert.match(prompt, /이미 유효한 준비값은 재사용/);
  assert.match(prompt, /부족한 항목을 구체적으로 요청/);
  assert.match(prompt, /TC가 요구하지 않는 상위 등록·최종 제출은 실행하지 않는다/);
  assert.match(prompt, /2026-11-10 10:00 ~ 2026-11-17 18:00/);
  assert.match(prompt, /업로드할 수 있는 파일: thumbnail_570x285.png/);
  assert.match(prompt, /1\. 제목을 비운다/);
  assert.match(prompt, /로그인, CAPTCHA, 2차 인증이 필요하면 login:true/);
});
