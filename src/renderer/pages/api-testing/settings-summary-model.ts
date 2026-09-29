import { scenarioStepInputs, type Scenario } from "../../../app/api-testing/shared/scenario";
export function configuredFields(scenario: Scenario, index: number) {
  const step = scenario.steps[index];
  return Object.entries(step.request).flatMap(([area, values]) => {
    const entries = values && typeof values === "object" && !Array.isArray(values) ? Object.entries(values) : [["", values]];
    const flatten = (key: string, value: unknown, path: string[]): Array<{ key: string; value: unknown; path: string[] }> => {
      if (value && typeof value === "object" && Object.keys(value).length) return Object.entries(value).flatMap(([child, v]) => flatten(key, v, [...path, child]));
      return [{ key, value, path }];
    };
    return entries.flatMap(([key, value]) => flatten(String(key), value, [area, ...(key ? [String(key)] : [])])).map(({ key, value, path }) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const global = /^\{\{globals\.([^}]+)\}\}$/.exec(text)?.[1];
      const variable = /^\{\{vars\.([^}]+)\}\}$/.exec(text)?.[1];
      const binding = scenario.valueBindings.find(b => b.name === variable);
      const input = scenarioStepInputs(step).find(i => i.name === variable);
      let label = global ? `전역변수 ${global}` : input ? "실행 중 입력" : text;
      if (variable && !binding && !input) {
        const from = scenario.steps.findIndex(s => s.extract.some(e => e.target === `vars.${variable}`));
        label = from >= 0 ? `${from + 1}단계 추출값 ${variable}` : `변수 ${variable}`;
      }
      let warning = "";
      if (binding) {
        const from = scenario.steps.findIndex(s => s.id === binding.step);
        label = `${from + 1}단계 ${binding.source === "response" ? "응답" : "요청"} ${binding.header ?? binding.pointer ?? "전체"}`;
        if (from < 0) warning = "출처 삭제됨";
        else if (from >= index) warning = "출처가 앞선 단계여야 합니다";
      }
      return { key: `${area}:${key}`, path, field: path.join("."), value, label, global, warning, direct: !global && !variable && !text?.includes("{{") };
    });
  });
}
