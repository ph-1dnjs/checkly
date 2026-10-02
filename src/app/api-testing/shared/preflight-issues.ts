// Reading the pre-run issues that previewScenario writes, e.g.
// "2단계 · 상품 조회: 인증 전역변수 'accessToken' 값이 없습니다. 전역변수에서 설정하세요".

const missingPattern = /^(?:(\d+)단계 · .*?: )?(?:인증 )?전역변수 '([A-Za-z][A-Za-z0-9_]*)' 값이 없습니다/;
const globalPattern = /전역변수 '([A-Za-z][A-Za-z0-9_]*)'/;

/** The global an issue says has no value, and the step that needs it. Other global issues (a malformed token) are not "missing". */
export function missingGlobalIssue(issue: string): { name: string; step?: number } | undefined {
  const match = missingPattern.exec(issue);
  if (!match) return undefined;
  return { name: match[2], ...(match[1] ? { step: Number(match[1]) } : {}) };
}

/** The global an issue is about (missing or invalid), for a "설정하기" link. */
export function issueGlobal(issue: string): string | undefined {
  return globalPattern.exec(issue)?.[1];
}

/** Step numbers as short text: consecutive runs become ranges ([1,2,3,5] → "1~3·5"). */
export function stepNumbersText(steps: number[]): string {
  const sorted = [...new Set(steps)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length;) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    parts.push(end - index >= 2 ? `${sorted[index]}~${sorted[end]}` : sorted.slice(index, end + 1).join("·"));
    index = end + 1;
  }
  return parts.join("·");
}

/** One entry per missing global with the steps that need it (in order of appearance); everything else as written, once. */
export function groupMissingGlobals(issues: string[]): { globals: Array<{ name: string; steps: number[] }>; others: string[] } {
  const globals = new Map<string, number[]>();
  const others: string[] = [];
  for (const issue of issues) {
    const missing = missingGlobalIssue(issue);
    if (!missing) { if (!others.includes(issue)) others.push(issue); continue; }
    const steps = globals.get(missing.name) ?? [];
    if (missing.step !== undefined && !steps.includes(missing.step)) steps.push(missing.step);
    globals.set(missing.name, steps);
  }
  return { globals: [...globals].map(([name, steps]) => ({ name, steps })), others };
}
