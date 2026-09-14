import type { Json } from "../shared/scenario";

export class MissingValue extends Error {}
export type Variables = Record<string, Json>;
export type Context = { inputs: Variables; vars: Variables; globals: Variables };
const reference = /\{\{(inputs|vars|globals)\.([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);

export function resolve(value: Json, context: Context): Json {
  if (Array.isArray(value)) return value.map(v => resolve(v, context));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, context)]));
  if (typeof value !== "string") return value;
  const get = (scope: keyof Context, key: string): Json => {
    if (!own(context[scope], key)) throw new MissingValue(`변수 없음: ${scope}.${key}`);
    return context[scope][key];
  };
  const exact = /^\{\{(inputs|vars|globals)\.([A-Za-z][A-Za-z0-9_]*)\}\}$/.exec(value);
  if (exact) return structuredClone(get(exact[1] as keyof Context, exact[2]));
  const result = value.replace(reference, (_, scope, key) => {
    const v = get(scope, key);
    if (typeof v === "object") throw new Error("객체·배열·null은 문자열 안에 삽입할 수 없습니다");
    return String(v);
  });
  if (/\{\{|\}\}/.test(result)) throw new Error("지원하지 않는 변수 참조 문법");
  return result;
}

export function atPointer(body: Json, pointer: string): Json | undefined {
  if (pointer === "") return body;
  let current: Json | undefined = body;
  for (const part of pointer.slice(1).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object" || !own(current, key)) return undefined;
    current = (current as Record<string, Json>)[key];
  }
  return current;
}

/** Session-only storage. Persistence and OS secret storage are UI integration work. */
export class GlobalStore {
  private values = new Map<string, Variables>();
  private active = new Set<string>();
  clear(project: string, environment: string) { this.values.delete(this.key(project, environment)); }
  private key(project: string, environment: string) { return JSON.stringify([project, environment]); }
  snapshot(project: string, environment: string): Variables {
    return structuredClone(this.values.get(this.key(project, environment)) ?? {});
  }
  commit(project: string, environment: string, values: Variables) {
    const key = this.key(project, environment);
    this.values.set(key, { ...this.values.get(key), ...structuredClone(values) });
  }
  delete(project: string, environment: string, name: string) {
    const key = this.key(project, environment);
    const values = { ...this.values.get(key) };
    delete values[name];
    this.values.set(key, values);
  }
  acquire(project: string, environment: string): () => void {
    const key = this.key(project, environment);
    if (this.active.has(key)) throw new Error("같은 프로젝트·환경에서 이미 실행 중입니다");
    this.active.add(key);
    return () => { this.active.delete(key); };
  }
}
