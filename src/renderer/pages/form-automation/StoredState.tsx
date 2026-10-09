import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  FORM_AUTOMATION_STORAGE_KEYS,
  type FormAutomationStorageKey,
  type FormAutomationStoredValues,
} from "../../../app/ipc/form-automation/storageTypes";

const readLegacyValues = (): FormAutomationStoredValues => {
  const values: FormAutomationStoredValues = {};
  for (const key of FORM_AUTOMATION_STORAGE_KEYS) {
    try {
      const text = window.localStorage.getItem(key);
      if (text !== null) values[key] = JSON.parse(text);
    } catch { /* Leave inaccessible or malformed legacy entries untouched. */ }
  }
  return values;
};

type StoredState = {
  values: FormAutomationStoredValues;
  save: (key: FormAutomationStorageKey, value: unknown) => Promise<boolean>;
};
const StorageContext = createContext<StoredState | null>(null);

const PENDING_STORAGE_KEY = "checkly-form-pending-native-state";
const storageErrorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const missingStorageHandler = (error: unknown) =>
  /No handler registered for ['"]form-automation:(?:load|set)-state['"]/.test(storageErrorText(error));

// Replay only explicit compatibility edits onto the native snapshot. A stale
// localStorage mirror must never replace other settings or resurrect deletions.
const readPendingValues = (): FormAutomationStoredValues => {
  let text: string | null;
  try { text = window.localStorage.getItem(PENDING_STORAGE_KEY); }
  catch { return {}; }
  if (text === null) return {};
  const values: unknown = JSON.parse(text);
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("임시 저장 데이터의 형식을 확인해 주세요.");
  return Object.fromEntries(FORM_AUTOMATION_STORAGE_KEYS
    .filter(key => Object.hasOwn(values, key))
    .map(key => [key, (values as FormAutomationStoredValues)[key]]));
};

const readLocalSnapshot = (): FormAutomationStoredValues => {
  const legacy = readLegacyValues();
  try { return { ...legacy, ...readPendingValues() }; }
  catch { return legacy; }
};

const writeCompatibilityValue = (key: FormAutomationStorageKey, value: unknown) => {
  window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ ...readPendingValues(), [key]: value }));
  // The journal is authoritative until native storage reconnects.
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Journal already saved. */ }
};

export function FormAutomationStorageProvider({ children }: { children: ReactNode }) {
  const [storage, setStorage] = useState<StoredState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [compatibilityMode, setCompatibilityMode] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const api = window.electronAPI;
    const initialize = async () => {
      const legacy = readLegacyValues();
      let mode: "native" | "browser" | "compatibility" | "blocked" = !api ? "browser"
        : typeof api.loadFormAutomationState === "function" && typeof api.setFormAutomationState === "function" ? "native" : "compatibility";
      let values = readLocalSnapshot();
      let initializationError = "";
      try {
        if (mode === "native") {
          values = (await api.loadFormAutomationState(legacy)).values;
          const changes = readPendingValues();
          values = { ...values, ...changes };
          for (const key of FORM_AUTOMATION_STORAGE_KEYS) {
            if (Object.hasOwn(changes, key)) await api.setFormAutomationState(key, changes[key]);
          }
          if (Object.keys(changes).length) window.localStorage.removeItem(PENDING_STORAGE_KEY);
        }
      } catch (error) {
        if (missingStorageHandler(error)) mode = "compatibility";
        else { mode = "blocked"; initializationError = storageErrorText(error); }
      }
      if (!active) return;
      setCompatibilityMode(mode === "compatibility");
      setLoadError(initializationError);
      let pending: Promise<unknown> = Promise.resolve();
      const state: StoredState = {
        values,
        save: (key, value) => {
          state.values[key] = value;
          const write = pending.then(async () => {
            if (mode === "blocked") throw new Error("저장 데이터를 다시 불러온 뒤 저장해 주세요.");
            if (mode === "native") {
              try { await api.setFormAutomationState(key, value); }
              catch (error) {
                if (!missingStorageHandler(error)) throw error;
                mode = "compatibility";
                if (active) setCompatibilityMode(true);
              }
            }
            if (mode === "compatibility") { writeCompatibilityValue(key, value); return; }
            // In Electron this is a mirror; the native file remains authoritative.
            try { window.localStorage.setItem(key, JSON.stringify(value)); }
            catch (error) { if (mode === "browser") throw error; }
          });
          pending = write.catch(() => undefined);
          return write.then(() => { if (active) setSaveError(""); return true; }, error => {
            if (active) setSaveError(storageErrorText(error));
            return false;
          });
        },
      };
      setStorage(state);
    };
    void initialize().catch(error => {
      if (active) setLoadError(storageErrorText(error));
    });
    return () => { active = false; };
  }, [attempt]);

  const retry = () => { setLoadError(""); setSaveError(""); setCompatibilityMode(false); setStorage(null); setAttempt(value => value + 1); };
  if (!storage) return <div className="fa-discovery-notice" role={loadError ? "alert" : "status"}>
    {loadError ? <><span>저장 데이터를 불러오지 못했습니다: {loadError}</span><button onClick={retry}>다시 불러오기</button></> : "저장한 자동 입력 데이터를 불러오는 중입니다."}
  </div>;
  return <StorageContext.Provider key={attempt} value={storage}>
    {loadError && <div className="fa-discovery-notice" role="alert">
      <span>저장 데이터를 불러오지 못해 기존 화면 저장본으로 표시합니다. 저장은 연결 복구 후 가능합니다: {loadError}</span>
      <button onClick={retry}>다시 불러오기</button>
    </div>}
    {compatibilityMode && <div className="fa-discovery-notice" role="status">
      <span>파일 저장 연결을 기다리는 중입니다. 변경한 값은 현재 화면 저장소에 보관하며, 앱을 다시 실행하거나 연결을 재시도하면 파일에 반영합니다.</span>
      <button onClick={retry}>저장 연결 다시 시도</button>
    </div>}
    {saveError && <div className="fa-discovery-notice" role="alert">자동 입력 데이터 저장 실패: {saveError}</div>}
    {children}
  </StorageContext.Provider>;
}

export const useStoredState = <T,>(key: FormAutomationStorageKey, fallback: T) => {
  const storage = useContext(StorageContext);
  if (!storage) throw new Error("자동 입력 저장소가 준비되지 않았습니다.");
  const [value, setValue] = useState<T>(() => Object.hasOwn(storage.values, key) ? storage.values[key] as T : fallback);
  const current = useRef(value);
  const update = useCallback((action: SetStateAction<T>): Promise<boolean> => {
    const previous = current.current;
    const next = typeof action === "function" ? (action as (previous: T) => T)(previous) : action;
    current.current = next;
    setValue(next);
    return storage.save(key, next).then(saved => {
      if (!saved && current.current === next) {
        current.current = previous;
        storage.values[key] = previous;
        setValue(previous);
      }
      return saved;
    });
  }, [key, storage]);
  return [value, update] as const;
};
