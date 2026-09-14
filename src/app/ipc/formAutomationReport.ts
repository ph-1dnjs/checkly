import ExcelJS from "exceljs";

const EXCEL_CELL_LIMIT = 32767;
const HEADER_ROW = 5;

type SessionEvent = Record<string, unknown>;

export const isSessionEventError = (event: SessionEvent = {}): boolean =>
  Boolean(
    event.category === "page"
    || event.error
    || Number(event.status) === 0
    || Number(event.status) >= 400,
  );

const cellText = (value: unknown): string => {
  if (value == null) return "";
  let valueText: string;
  if (typeof value === "string") valueText = value;
  else {
    try { valueText = JSON.stringify(value, null, 2); }
    catch { valueText = String(value); }
  }
  if (valueText.length <= EXCEL_CELL_LIMIT) return valueText;
  const suffix = "\n… (Excel 셀 길이 제한으로 일부 내용 생략)";
  return `${valueText.slice(0, EXCEL_CELL_LIMIT - suffix.length)}${suffix}`;
};
const eventDate = (value: unknown): Date | string => {
  const date = value ? new Date(String(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? date : cellText(value);
};

const sourceLocation = (event: SessionEvent): string => {
  if (!event.source) return "";
  const position = event.line || event.column
    ? `:${event.line || 0}:${event.column || 0}`
    : "";
  return `${event.source}${position}`;
};

export const createFormAutomationWorkbook = async (
  events: SessionEvent[],
  generatedAt = new Date(),
): Promise<{ buffer: Buffer; count: number; errorCount: number }> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Checkly";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  const sheet = workbook.addWorksheet("활동·오류 기록", {
    properties: { defaultRowHeight: 24 },
    views: [{ state: "frozen", ySplit: HEADER_ROW, activeCell: "A6" }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.mergeCells("A1:O1");
  const title = sheet.getCell("A1");
  title.value = "Checkly 폼 자동 완성 네트워크·오류 기록";
  title.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17607F" } };
  title.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 34;
  const errorCount = events.filter(isSessionEventError).length;
  sheet.getCell("A2").value = "내보낸 시각";
  sheet.getCell("B2").value = generatedAt;
  sheet.getCell("B2").numFmt = "yyyy-mm-dd hh:mm:ss";
  sheet.getCell("A3").value = "요약";
  sheet.getCell("B3").value = `전체 ${events.length}건 · 오류 ${errorCount}건 · 정상 ${events.length - errorCount}건`;
  for (const address of ["A2", "A3"])
    sheet.getCell(address).font = { name: "Arial", bold: true, color: { argb: "FF17607F" } };
  const headers = [
    "번호", "수준", "발생 시각", "세션", "메서드", "상태", "소요 시간(ms)", "오버라이드",
    "URL", "페이지 URL", "오류 메시지", "소스 위치", "요청 데이터", "응답 데이터", "스택",
  ];
  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.values = headers;
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF26323A" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  events.forEach((event, index) => {
    const row = sheet.addRow([
      index + 1,
      isSessionEventError(event) ? "ERROR" : "INFO",
      eventDate(event.at),
      cellText(event.browserSessionName || event.type),
      cellText(event.method),
      event.status ?? "",
      event.elapsed ?? "",
      event.overridden == null ? "" : (event.overridden ? "예" : "아니오"),
      cellText(event.url),
      event.pageUrl && event.pageUrl !== event.url ? cellText(event.pageUrl) : "",
      cellText(event.error),
      cellText(sourceLocation(event)),
      cellText(event.requestBody),
      cellText(event.responseBody),
      cellText(event.stack),
    ]);
    row.height = event.requestBody != null || event.responseBody != null || event.stack ? 72 : 30;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: "Arial", size: 10, color: { argb: "FF26323A" } };
      cell.alignment = { vertical: "top", horizontal: [1, 2, 5, 6, 7, 8].includes(column) ? "center" : "left", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD8DDE2" } } };
      if (isSessionEventError(event)) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFECEF" } };
      else if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7F8" } };
    });
    row.getCell(2).font = { name: "Arial", size: 10, bold: true, color: { argb: isSessionEventError(event) ? "FFB32318" : "FF1E7A4A" } };
    if (row.getCell(3).value instanceof Date) row.getCell(3).numFmt = "yyyy-mm-dd hh:mm:ss";
  });
  const widths = [8, 10, 20, 19, 12, 10, 14, 13, 42, 42, 35, 36, 48, 58, 58];
  sheet.columns.forEach((column, index) => { column.width = widths[index]; });
  sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: headers.length } };
  const output = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(output), count: events.length, errorCount };
};
