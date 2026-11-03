-- ph-1dnjs 2026-11-02: 마우스를 올려 드롭다운을 여는 호버(hover) 액션 허용.
-- 선행 조건: 20261102000000_web_scenario_expect_no_text.sql 적용 완료. 다시 실행해도 안전하다.
alter table public.web_scenario_steps drop constraint if exists web_scenario_steps_action_check;
alter table public.web_scenario_steps add constraint web_scenario_steps_action_check
  check (action in ('goto','fill','fileUpload','click','hover','select','expectText','expectNoText','manualFill','manualControl','manualResult'));
