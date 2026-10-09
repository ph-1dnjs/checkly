import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  FORM_AUTOMATION_STORAGE_KEYS,
  type FormAutomationStorageKey,
  type FormAutomationStoredState,
  type FormAutomationStoredValues,
} from "./storageTypes";

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const legacyValues = (value: unknown): FormAutomationStoredValues => {
  if (!record(value)) return {};
  return Object.fromEntries(FORM_AUTOMATION_STORAGE_KEYS
    .filter(key => Object.hasOwn(value, key))
    .map(key => [key, value[key]]));
};

export class FormAutomationStorage {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  // Serialize the whole read/modify/write operation, including migrations, so
  // concurrent settings updates cannot replace one another's saved cases.
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async read(filePath: string): Promise<FormAutomationStoredState | null> {
    let text: string;
    try { text = await readFile(filePath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const data: unknown = JSON.parse(text);
    if (!record(data) || data.version !== 1 || !record(data.values))
      throw new Error("자동 입력 저장 파일의 형식을 확인해 주세요.");
    return data as FormAutomationStoredState;
  }

  private async current(): Promise<FormAutomationStoredState | null> {
    try {
      const state = await this.read(this.filePath);
      return state ?? await this.read(`${this.filePath}.bak`);
    } catch (error) {
      // Never turn a read/parse failure into an empty list and overwrite it.
      const backup = await this.read(`${this.filePath}.bak`);
      if (backup) return backup;
      throw error;
    }
  }

  private async atomicWrite(filePath: string, state: FormAutomationStoredState): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(state), "utf8");
        await file.sync();
      } finally { await file.close(); }
      await rename(temporary, filePath);
    } finally { await rm(temporary, { force: true }); }
  }

  load(legacy: unknown = {}): Promise<FormAutomationStoredState> {
    return this.serial(async () => {
      const existing = await this.current();
      if (existing) return existing;
      // Import localStorage once. An existing native empty list is authoritative
      // too, so deleted cases cannot return from a stale browser origin.
      const initial: FormAutomationStoredState = { version: 1, values: legacyValues(legacy) };
      await this.atomicWrite(`${this.filePath}.bak`, initial);
      await this.atomicWrite(this.filePath, initial);
      return initial;
    });
  }

  set(key: FormAutomationStorageKey, value: unknown): Promise<void> {
    if (!FORM_AUTOMATION_STORAGE_KEYS.includes(key))
      return Promise.reject(new Error("지원하지 않는 자동 입력 저장 항목입니다."));
    // Snapshot IPC input before queuing it; callers cannot mutate a pending save.
    const snapshot: unknown = JSON.parse(JSON.stringify(value));
    return this.serial(async () => {
      const previous = await this.current() ?? { version: 1 as const, values: {} };
      const next: FormAutomationStoredState = { ...previous, values: { ...previous.values, [key]: snapshot } };
      await this.atomicWrite(`${this.filePath}.bak`, previous);
      await this.atomicWrite(this.filePath, next);
    });
  }
}
