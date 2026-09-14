export const MAX_FORM_SESSIONS = 8;

export type BrowserSession = {
  id: string;
  name: string;
  url: string;
  currentPageUrl: string;
  state: "loading" | "ready" | "error";
  history: { back: boolean; forward: boolean };
};

export type DateRangeValue = {
  __qaDateRange: true;
  start: string;
  end: string;
};

export type FileValue = {
  __qaFile: true;
  valid: boolean;
  accept: string;
  multiple: boolean;
};

export type FieldValue = string | boolean | null | string[] | DateRangeValue | FileValue;

export type DetectedField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  placeholder: string;
  minLength: number;
  maxLength: number;
  min: string;
  max: string;
  pattern: string;
  accept: string;
  multiple: boolean;
  context: "form" | "search";
  options: Array<{ value: string; label: string; disabled: boolean }>;
};

export type AutofillCase = {
  id: string;
  name: string;
  kind: "success" | "failure";
  generated: boolean;
  userSaved?: boolean;
  screen: string;
  fieldMode: "name";
  fields: Record<string, FieldValue>;
  fieldMeta: DetectedField[];
  expected: string;
  pageScope?: string;
  pageUrl?: string;
  savedAt?: string;
};

export const defaultBrowserSession = (url: string): BrowserSession => ({
  id: "default",
  name: "기본 세션",
  url,
  currentPageUrl: url,
  state: "loading",
  history: { back: false, forward: false },
});

export const browserSessionPartition = (sessionId: string): string => {
  if (sessionId === "default") return "persist:checkly-form-automation";
  const safeId = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `persist:checkly-form-automation-${safeId || "session"}`;
};

export const normalizeBrowserSessions = (
  value: BrowserSession[],
  fallbackUrl: string,
): BrowserSession[] => {
  if (!Array.isArray(value) || !value.length)
    return [defaultBrowserSession(fallbackUrl)];
  const seen = new Set<string>();
  return value.slice(0, MAX_FORM_SESSIONS).flatMap((item, index) => {
    const id = String(item?.id || (index === 0 ? "default" : `session-${index + 1}`));
    if (seen.has(id)) return [];
    seen.add(id);
    const url = /^https?:\/\//i.test(String(item?.url || ""))
      ? item.url
      : fallbackUrl;
    return [{
      id,
      name: String(item?.name || (index === 0 ? "기본 세션" : `회원 세션 ${index + 1}`)).slice(0, 30),
      url,
      currentPageUrl: /^https?:\/\//i.test(String(item?.currentPageUrl || ""))
        ? item.currentPageUrl
        : url,
      state: "loading" as const,
      history: { back: false, forward: false },
    }];
  });
};

export const reorderBrowserSessions = (
  items: BrowserSession[],
  sourceId: string,
  targetId: string,
  placeAfter: boolean,
): BrowserSession[] => {
  if (!sourceId || !targetId || sourceId === targetId) return items;
  const source = items.find((item) => item.id === sourceId);
  if (!source || !items.some((item) => item.id === targetId)) return items;
  const remaining = items.filter((item) => item.id !== sourceId);
  const targetIndex = remaining.findIndex((item) => item.id === targetId);
  const insertIndex = targetIndex + (placeAfter ? 1 : 0);
  return [
    ...remaining.slice(0, insertIndex),
    source,
    ...remaining.slice(insertIndex),
  ];
};

const fitTextConstraint = (value: string, field: DetectedField): string => {
  const minimum = field.minLength > 0 ? field.minLength : 0;
  const maximum = field.maxLength > 0 ? field.maxLength : Infinity;
  let next = value;
  if (minimum && next.length < minimum) next = next.padEnd(minimum, "가");
  return next.slice(0, maximum);
};

export const detectedFieldValue = (
  field: DetectedField,
  valid: boolean,
): FieldValue => {
  const hint = `${field.name} ${field.label} ${field.placeholder}`.toLowerCase();
  const firstOption =
    field.options.find((option) => option.value !== "" && !option.disabled)?.value ?? "";

  if (field.type === "file")
    return {
      __qaFile: true,
      valid,
      accept: field.accept,
      multiple: field.multiple,
    };
  if (field.type === "date-trigger") {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const format = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { __qaDateRange: true, start: format(start), end: format(today) };
  }

  if (!valid) {
    if (field.type === "checkbox") return false;
    if (field.type === "radio") return null;
    if (field.type === "email") return "wrong-email";
    if (field.type === "url") return "invalid-url";
    if (field.type === "tel") return "12";
    if (field.type === "number" || field.type === "range") {
      if (field.min !== "" && Number.isFinite(Number(field.min)))
        return String(Number(field.min) - 1);
      if (field.max !== "" && Number.isFinite(Number(field.max)))
        return String(Number(field.max) + 1);
      return "";
    }
    if (field.type === "select-one" || field.type === "select-multiple") return "";
    if (field.minLength > 1) return "A";
    return "";
  }

  if (field.type === "checkbox") return true;
  if (field.type === "radio" || field.type === "select-one") return firstOption;
  if (field.type === "select-multiple")
    return field.options
      .filter((option) => option.value !== "" && !option.disabled)
      .slice(0, 2)
      .map((option) => option.value);
  if (field.type === "email" || hint.includes("이메일")) return "qa.user@example.com";
  if (field.type === "password" || hint.includes("비밀번호"))
    return fitTextConstraint("Qa1234!@#", field);
  if (field.type === "tel" || /phone|mobile|전화|휴대폰/.test(hint))
    return "010-1234-5678";
  if (field.type === "url") return "https://example.com";
  if (field.type === "date") return "2026-08-25";
  if (field.type === "datetime-local") return "2026-08-25T10:00";
  if (field.type === "month") return "2026-08";
  if (field.type === "time") return "10:00";
  if (field.type === "number" || field.type === "range") {
    const minimum = field.min !== "" && Number.isFinite(Number(field.min)) ? Number(field.min) : 1;
    const maximum = field.max !== "" && Number.isFinite(Number(field.max)) ? Number(field.max) : minimum;
    return String(Math.min(Math.max(minimum, 1), maximum));
  }
  if (/노출 영역|exposure area|screen/.test(hint)) return fitTextConstraint("홈", field);
  if (/업체|store|company/.test(hint)) return fitTextConstraint("QA 테스트 업체", field);
  if (/title|subject|제목/.test(hint)) return fitTextConstraint("QA 자동 입력 제목", field);
  if (/author|writer|작성자/.test(hint)) return fitTextConstraint("QA 테스트 작성자", field);
  if (/keyword|search|검색/.test(hint)) return fitTextConstraint("QA 검색어", field);
  if (/answer|reply|답변|소명/.test(hint))
    return fitTextConstraint("QA 자동 입력으로 생성한 테스트 답변입니다.", field);
  if (/content|description|body|내용|설명/.test(hint))
    return fitTextConstraint("QA 자동 입력으로 생성한 테스트 내용입니다.", field);
  if (/name|이름|담당자/.test(hint)) return fitTextConstraint("QA 테스트 사용자", field);
  if (/code|코드/.test(hint)) return fitTextConstraint("QA-001", field);
  return fitTextConstraint(
    field.placeholder && !field.placeholder.includes("입력")
      ? field.placeholder
      : "QA 자동 입력값",
    field,
  );
};

export const detectedCases = (fields: DetectedField[]): AutofillCase[] => {
  const makeCase = (
    kind: "success" | "failure",
    targetFields: DetectedField[],
    screen: string,
  ): AutofillCase => {
    const valid = kind === "success";
    const fieldsByName = Object.fromEntries(
      targetFields.map((field) => [field.name, detectedFieldValue(field, valid)]),
    );
    return {
      id: `detected-${screen === "검색 필터 자동 감지" ? "search" : "form"}-${kind}`,
      name: `${screen === "검색 필터 자동 감지" ? "현재 검색 필터" : "현재 입력 화면"} · ${valid ? "정상값" : "유효성 오류값"}`,
      kind,
      generated: true,
      screen,
      fieldMode: "name",
      fields: fieldsByName,
      fieldMeta: targetFields.map((field) => ({ ...field })),
      expected: valid
        ? "필드가 채워지고 제출 조건을 만족한다."
        : "필드 오류가 노출되고 잘못된 제출이 차단된다.",
    };
  };

  const formFields = fields.filter((field) => field.context === "form");
  const searchFields = fields.filter((field) => field.context === "search");
  return [
    ...(searchFields.length
      ? [makeCase("success", searchFields, "검색 필터 자동 감지")]
      : []),
    ...(formFields.length
      ? [
          makeCase("success", formFields, "폼·컴포넌트 메타 자동 감지"),
          makeCase("failure", formFields, "폼·컴포넌트 메타 자동 감지"),
        ]
      : []),
  ];
};

export const caseValueCount = (item?: AutofillCase): number =>
  Object.keys(item?.fields ?? {}).length;

export const cloneFields = (
  fields?: Record<string, FieldValue>,
): Record<string, FieldValue> => {
  try {
    return JSON.parse(JSON.stringify(fields ?? {})) as Record<string, FieldValue>;
  } catch {
    return { ...(fields ?? {}) };
  }
};

export const pageScopeFromUrl = (value: string): string => {
  try {
    const url = new URL(value);
    const [rootSegment] = url.pathname.split("/").filter(Boolean);
    return `${url.origin}${rootSegment ? `/${rootSegment}` : ""}`;
  } catch {
    const [rootSegment] = value.split(/[?#]/)[0].split("/").filter(Boolean);
    return rootSegment ? `/${rootSegment}` : "/";
  }
};

export const pageScopeLabel = (value: string): string => {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return value || "/";
  }
};
