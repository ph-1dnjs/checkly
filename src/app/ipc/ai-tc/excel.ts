import ExcelJS from "exceljs";
import { AI_TC_LIMITS, findHeaderRow, guessMapping, type AiTcRawRow, type AiTcSheet, type AiTcWorkbook } from "./model";

/** 가져오기를 멈추는 오류. 화면에 그대로 보여 준다. */
export class AiTcImportError extends Error {}

type CellText = { text: string; formulaWithoutValue: boolean };

/** 셀 값을 표시 텍스트로 바꾼다. 수식은 실행하지 않고 캐시된 결과만 쓴다. */
function cellText(value: ExcelJS.CellValue): CellText {
  if (value === null || value === undefined) return { text: "", formulaWithoutValue: false };
  if (typeof value === "string") return { text: value, formulaWithoutValue: false };
  if (typeof value === "number" || typeof value === "boolean") return { text: String(value), formulaWithoutValue: false };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10), formulaWithoutValue: false };
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return { text: value.richText.map(part => part.text).join(""), formulaWithoutValue: false };
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      if (result === undefined || result === null || (typeof result === "object" && "error" in (result as object))) return { text: "", formulaWithoutValue: true };
      return cellText(result);
    }
    if ("text" in value && typeof value.text === "string") return { text: value.text, formulaWithoutValue: false };
    if ("hyperlink" in value) return { text: String((value as { hyperlink: string }).hyperlink), formulaWithoutValue: false };
    if ("error" in value) return { text: "", formulaWithoutValue: false };
  }
  return { text: String(value), formulaWithoutValue: false };
}

/** .xlsx를 읽어 시트·머리글·행을 만든다. 원본은 바꾸지 않으며 매크로·외부 링크는 다루지 않는다. */
export async function readWorkbook(fileName: string, buffer: Buffer): Promise<AiTcWorkbook> {
  if (!/\.xlsx$/i.test(fileName)) throw new AiTcImportError("지원하지 않는 형식입니다. .xlsx 파일만 가져올 수 있습니다.");
  if (buffer.length > AI_TC_LIMITS.fileBytes) throw new AiTcImportError(`파일이 ${Math.round(AI_TC_LIMITS.fileBytes / 1024 / 1024)}MB를 넘습니다.`);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as unknown as ArrayBuffer); }
  catch { throw new AiTcImportError("파일을 읽지 못했습니다. 손상되었거나 암호가 걸린 파일일 수 있습니다."); }
  if (workbook.worksheets.length > AI_TC_LIMITS.sheets) throw new AiTcImportError(`시트가 ${AI_TC_LIMITS.sheets}개를 넘습니다.`);
  const sheets: AiTcSheet[] = [];
  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount > AI_TC_LIMITS.rowsPerSheet) throw new AiTcImportError(`'${worksheet.name}' 시트의 행이 ${AI_TC_LIMITS.rowsPerSheet}개를 넘습니다.`);
    if (worksheet.columnCount > AI_TC_LIMITS.columns) throw new AiTcImportError(`'${worksheet.name}' 시트의 열이 ${AI_TC_LIMITS.columns}개를 넘습니다.`);
    const rows: AiTcRawRow[] = [];
    worksheet.eachRow({ includeEmpty: false }, row => {
      const raw: AiTcRawRow = { row: row.number, hidden: Boolean(row.hidden), cells: {}, mergedFrom: [], formulaWithoutValue: [] };
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        // 병합 범위의 나머지 칸은 첫 칸 값을 이어받는다. TC ID·단계·기대 결과는 buildCases에서 다시 거른다.
        const source = cell.isMerged && cell.master && cell.master.address !== cell.address ? cell.master : cell;
        const { text, formulaWithoutValue } = cellText(source.value);
        if (text.length > AI_TC_LIMITS.cellChars) throw new AiTcImportError(`'${worksheet.name}' ${row.number}행 ${col}열 칸이 ${AI_TC_LIMITS.cellChars}자를 넘습니다.`);
        if (source !== cell) raw.mergedFrom.push(col);
        if (formulaWithoutValue) raw.formulaWithoutValue.push(col);
        if (text.trim()) raw.cells[col] = text;
      });
      if (Object.keys(raw.cells).length || raw.formulaWithoutValue.length) rows.push(raw);
    });
    const headerRow = findHeaderRow(rows);
    const headerCells = rows.find(row => row.row === headerRow)?.cells ?? {};
    const headers = Object.entries(headerCells).map(([col, label]) => ({ col: Number(col), label: label.replace(/\s+/g, " ").trim() }));
    sheets.push({ name: worksheet.name, hidden: worksheet.state !== "visible", headerRow, headers, rows, mapping: headerRow ? guessMapping(headers) : {} });
  }
  if (!sheets.some(sheet => sheet.headerRow)) throw new AiTcImportError("TC ID와 기대 결과 머리글이 있는 시트를 찾지 못했습니다.");
  return { fileName, sheets };
}
