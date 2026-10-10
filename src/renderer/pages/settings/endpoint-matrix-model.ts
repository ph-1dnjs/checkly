import type {
  EndpointKind,
  ProjectEndpoint,
  ProjectEnvironment,
  ProjectSettings,
} from "../../shared/model/electron-api/auth";

export type MatrixCell = { baseUrl: string; specUrl: string; updatedAt?: string };

/** 편집 중인 엔드포인트 × 환경 표. 칸은 `${endpointId}:${environmentId}`로 찾는다. */
export type MatrixDraft = {
  endpoints: ProjectEndpoint[];
  environments: ProjectEnvironment[];
  cells: Record<string, MatrixCell>;
};

export const cellKey = (endpointId: string, environmentId: string) => `${endpointId}:${environmentId}`;

const byPosition = <T extends { position: number }>(items: T[]) => [...items].sort((a, b) => a.position - b.position);

export const toDraft = (settings: ProjectSettings): MatrixDraft => ({
  endpoints: byPosition(settings.endpoints),
  environments: byPosition(settings.environments),
  cells: Object.fromEntries(
    settings.urls.map((url) => [
      cellKey(url.endpointId, url.environmentId),
      { baseUrl: url.baseUrl, specUrl: url.specUrl ?? "", updatedAt: url.updatedAt },
    ]),
  ),
});

/**
 * 저장할 전체 표. 빈 칸(기본 주소가 비어 있음)은 미설정이므로 urls에서 뺀다.
 * 스웨거 주소는 api 엔드포인트에서만 보낸다.
 */
export const fromDraft = (draft: MatrixDraft): ProjectSettings => {
  const endpoints = draft.endpoints.map((endpoint, position) => ({ ...endpoint, name: endpoint.name.trim(), position }));
  const environments = draft.environments.map((environment, position) => ({ ...environment, name: environment.name.trim(), position }));
  const urls = endpoints.flatMap((endpoint) =>
    environments.flatMap((environment) => {
      const cell = draft.cells[cellKey(endpoint.id, environment.id)];
      const baseUrl = cell?.baseUrl.trim() ?? "";
      if (!baseUrl) return [];
      const specUrl = endpoint.kind === "api" ? cell.specUrl.trim() || null : null;
      return [{ endpointId: endpoint.id, environmentId: environment.id, baseUrl, specUrl, updatedAt: cell.updatedAt }];
    }),
  );
  return { endpoints, environments, urls };
};

/** 저장 내용이 같은지 비교(빈 칸 차이·공백 차이는 무시). */
export const sameSettings = (a: MatrixDraft, b: MatrixDraft) => JSON.stringify(fromDraft(a)) === JSON.stringify(fromDraft(b));

const isHttpUrl = (value: string) => {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
};

export type CellProblem = { base?: boolean; spec?: boolean };
export type MatrixValidation = {
  message: string;
  endpointNames: Set<string>;
  environmentNames: Set<string>;
  cells: Record<string, CellProblem>;
};

const duplicateIds = (items: Array<{ id: string; name: string }>) => {
  const seen = new Map<string, string>();
  const bad = new Set<string>();
  for (const item of items) {
    const name = item.name.trim().toLowerCase();
    if (!name) {
      bad.add(item.id);
      continue;
    }
    const first = seen.get(name);
    if (first) {
      bad.add(first);
      bad.add(item.id);
    } else seen.set(name, item.id);
  }
  return bad;
};

/** 첫 번째 문제를 문장으로, 나머지는 칸 표시용으로 돌려준다. 입력된 칸만 주소 형식을 본다. */
export const validateDraft = (draft: MatrixDraft): MatrixValidation => {
  const messages: string[] = [];
  const endpointNames = duplicateIds(draft.endpoints);
  const environmentNames = duplicateIds(draft.environments);
  if (draft.endpoints.some((endpoint) => !endpoint.name.trim())) messages.push("엔드포인트 이름을 입력하세요.");
  else if (endpointNames.size) messages.push("엔드포인트 이름이 겹칩니다.");
  if (draft.environments.some((environment) => !environment.name.trim())) messages.push("환경 이름을 입력하세요.");
  else if (environmentNames.size) messages.push("환경 이름이 겹칩니다.");

  const cells: Record<string, CellProblem> = {};
  for (const endpoint of draft.endpoints) {
    for (const environment of draft.environments) {
      const key = cellKey(endpoint.id, environment.id);
      const cell = draft.cells[key];
      if (!cell) continue;
      const where = `${endpoint.name.trim() || "엔드포인트"} · ${environment.name.trim() || "환경"}`;
      const base = cell.baseUrl.trim();
      const spec = endpoint.kind === "api" ? cell.specUrl.trim() : "";
      const problem: CellProblem = {};
      if (base && !isHttpUrl(base)) {
        problem.base = true;
        messages.push(`${where} 주소는 http:// 또는 https://로 시작해야 합니다.`);
      }
      if (spec && !isHttpUrl(spec)) {
        problem.spec = true;
        messages.push(`${where} 스웨거 주소는 http:// 또는 https://로 시작해야 합니다.`);
      }
      if (spec && !base) {
        problem.base = true;
        messages.push(`${where}: 스웨거 주소를 쓰려면 기본 주소도 입력하세요.`);
      }
      if (problem.base || problem.spec) cells[key] = problem;
    }
  }
  return { message: messages[0] ?? "", endpointNames, environmentNames, cells };
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;

export const addEndpoint = (draft: MatrixDraft, kind: EndpointKind = "web"): [MatrixDraft, string] => {
  const id = newId();
  return [{ ...draft, endpoints: [...draft.endpoints, { id, name: "", kind, position: draft.endpoints.length }] }, id];
};

export const addEnvironment = (draft: MatrixDraft): [MatrixDraft, string] => {
  const id = newId();
  return [{ ...draft, environments: [...draft.environments, { id, name: "", position: draft.environments.length }] }, id];
};
