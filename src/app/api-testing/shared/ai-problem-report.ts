import type { ApiAiImportResult } from "./workspace";

/**
 * What the user pastes back into their AI: each scenario by the name and document number the AI wrote
 * (never Checkly's generated id), its problems, and what is only a note. Empty when nothing needs fixing.
 * The AI answers by saving the result file again (copy-and-paste guide and in-app terminal alike).
 */
export function problemReport(result: ApiAiImportResult): string {
  const blocking = result.drafts.some(draft => draft.issues.length) || Boolean(result.suite?.problems.length);
  if (!blocking) return "";
  const scenarios = result.drafts.flatMap((draft, index) => {
    const lines = [
      ...draft.issues.map(issue => `- ${issue}`),
      // Same-name notices are left out: the user decides that in Checkly, and the AI would only rename and duplicate.
      ...draft.notices.filter(notice => !draft.sameName || !notice.startsWith("같은 이름의")).map(notice => `- (참고) ${notice}`),
      ...draft.executionIssues.map(issue => `- (실행 전 확인, YAML 문제가 아닐 수 있음) ${issue}`),
    ];
    return lines.length ? [[`### ${index + 1}번째 시나리오 · ${draft.name}`, ...lines].join("\n")] : [];
  });
  const suite = result.suite?.problems.length ? [["### 스위트", ...result.suite.problems.map(problem => `- ${problem}`)].join("\n")] : [];
  const missingApi = result.drafts.some(draft => draft.issues.some(issue => issue.includes("명세에 없는 API")));
  return [
    `Checkly 검사에서 아래 문제가 나왔습니다. 문제를 고친 전체 결과(모든 시나리오와 스위트)를 같은 결과 파일에 다시 저장하세요. id는 쓰지 마세요.`,
    ...scenarios, ...suite,
    ...(missingApi ? ["명세에 없는 API는 API 파일(api-catalog.json)에 있는 api 값을 그대로 쓰세요. 파일에 없는 API는 쓸 수 없습니다."] : []),
  ].join("\n\n");
}
