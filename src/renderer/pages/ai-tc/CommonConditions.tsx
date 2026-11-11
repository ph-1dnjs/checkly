import { commonPreconditions, type AiTcImportOptions, type AiTcWorkbook } from "../../../app/ipc/ai-tc/model";

/** 공통 조건은 TC 목록 위에서 한 번만 보여 주고 실행 데이터에는 시트별로 적용한다. */
export const CommonConditions = ({ workbook, options }: { workbook: AiTcWorkbook | null; options: AiTcImportOptions }) => {
  const conditions = new Map<string, string[]>();
  for (const sheet of workbook?.sheets ?? []) {
    const text = commonPreconditions(sheet, options).join("\n");
    if (text) conditions.set(text, [...(conditions.get(text) ?? []), sheet.name]);
  }
  if (!conditions.size) return null;
  return <section className="aitc-note" aria-label="공통 사전 조건">
    <strong>공통 사전 조건</strong>
    {[...conditions].map(([text, sheets]) => <div key={text}>
      <p>{sheets.join(" · ")}</p>
      {text.split("\n").map((line, index) => <div key={index}>{line}</div>)}
    </div>)}
  </section>;
};
