export type DateTimeOffsetUnit = "s" | "m" | "h" | "d";
export type DateTimeDefault =
  | { mode: "prompt" }
  | { mode: "function"; operation: "+" | "-" | ""; amount: string; unit: DateTimeOffsetUnit };

export function parseDateTimeDefault(value?: string): DateTimeDefault {
  if (!value) return { mode: "prompt" };
  const relative = /^now(?:\s*([+-])\s*(\d+)\s*([smhd]))?$/i.exec(value.trim());
  if (relative) return { mode: "function", operation: (relative[1] as "+" | "-" | undefined) ?? "", amount: relative[2] ?? "", unit: (relative[3]?.toLowerCase() as DateTimeOffsetUnit | undefined) ?? "d" };
  throw new Error("날짜·시간 기본값은 now 기준 함수만 지원합니다");
}

export function formatRelativeDateTimeDefault(operation: "+" | "-" | "", amount: string, unit: DateTimeOffsetUnit): string {
  const parsedAmount = Number(amount);
  return operation && Number.isInteger(parsedAmount) && parsedAmount > 0 ? `now${operation}${parsedAmount}${unit}` : "now";
}

