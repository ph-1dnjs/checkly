export const FORM_AUTOMATION_STORAGE_KEYS = [
  "checkly-form-target-url",
  "checkly-form-browser-sessions",
  "checkly-form-active-session",
  "checkly-form-saved-cases",
  "checkly-form-inspector-width",
  "checkly-form-network-list-height",
  "checkly-form-overrides",
  "checkly-form-openapi",
  "checkly-form-browser-zoom",
] as const;

export type FormAutomationStorageKey = typeof FORM_AUTOMATION_STORAGE_KEYS[number];
export type FormAutomationStoredValues = Partial<Record<FormAutomationStorageKey, unknown>>;
export type FormAutomationStoredState = { version: 1; values: FormAutomationStoredValues };
