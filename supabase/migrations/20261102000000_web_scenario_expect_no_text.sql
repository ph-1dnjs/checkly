-- ph-1dnjs 2026-11-02: 화면에 텍스트가 없어야 하는 결과 확인(expectNoText) 액션 허용.
-- 선행 조건: 20261014000000_web_scenario_runs.sql 적용 완료. 다시 실행해도 안전하다.
alter table public.web_scenario_steps drop constraint if exists web_scenario_steps_action_check;
alter table public.web_scenario_steps add constraint web_scenario_steps_action_check
  check (action in ('goto','fill','fileUpload','click','select','expectText','expectNoText','manualFill','manualControl','manualResult'));
