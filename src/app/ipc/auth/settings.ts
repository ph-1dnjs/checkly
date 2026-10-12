import { AuthFailure } from "./errors";
import type { ProjectEndpoint, ProjectEnvironment, ProjectEndpointUrl, ProjectSettings } from "./types";

// 프로젝트 설정(엔드포인트 × 환경 주소) 검사와 DB 행 변환. 저장은 save_project_settings(SQL)가 한다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL = /^https?:\/\/\S+$/i;

const fail = (message: string): never => {
  throw new AuthFailure(message);
};

const checkNames = <T extends { id: string; name: string }>(label: string, rows: T[]): void => {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const row of rows) {
    if (!UUID.test(row.id) || ids.has(row.id)) fail(`${label} ID가 올바르지 않습니다.`);
    if (!row.name) fail(`${label} 이름을 입력하세요.`);
    if (row.name.length > 100) fail(`${label} 이름은 100자 이하로 입력하세요.`);
    if (names.has(row.name)) fail(`${label} 이름이 겹칩니다: ${row.name}`);
    ids.add(row.id);
    names.add(row.name);
  }
};

/**
 * 저장 전 검사·정리. 이름·주소의 앞뒤 공백을 지우고, 주소가 빈 칸은 미설정(행 없음)으로 본다.
 * 스웨거 주소는 api 엔드포인트에만 남긴다. 틀리면 한국어 메시지로 AuthFailure를 던진다.
 */
export const normalizeSettings = (input: ProjectSettings): ProjectSettings => {
  const position = (value: unknown, index: number): number => (Number.isInteger(value) ? (value as number) : index);
  const endpoints: ProjectEndpoint[] = input.endpoints.map((e, index) => ({
    ...e,
    name: String(e.name ?? "").trim(),
    position: position(e.position, index),
  }));
  const environments: ProjectEnvironment[] = input.environments.map((e, index) => ({
    ...e,
    name: String(e.name ?? "").trim(),
    position: position(e.position, index),
  }));
  checkNames("엔드포인트", endpoints);
  checkNames("환경", environments);
  for (const e of endpoints) if (e.kind !== "web" && e.kind !== "api") fail("엔드포인트 종류는 web 또는 api여야 합니다.");

  const endpointById = new Map(endpoints.map(e => [e.id, e]));
  const environmentById = new Map(environments.map(e => [e.id, e]));
  const pairs = new Set<string>();
  const urls: ProjectEndpointUrl[] = [];
  for (const u of input.urls) {
    const endpoint = endpointById.get(u.endpointId);
    const environment = environmentById.get(u.environmentId);
    if (!endpoint || !environment) fail("없는 엔드포인트나 환경의 주소가 있습니다.");
    const pair = `${u.endpointId}/${u.environmentId}`;
    if (pairs.has(pair)) fail("같은 엔드포인트·환경의 주소가 두 번 들어 있습니다.");
    pairs.add(pair);
    const label = `${endpoint!.name} · ${environment!.name}`;
    const baseUrl = String(u.baseUrl ?? "").trim();
    const specUrl = endpoint!.kind === "api" ? String(u.specUrl ?? "").trim() || null : null;
    if (!baseUrl && !specUrl) continue;
    if (!HTTP_URL.test(baseUrl)) fail(`${label} 주소는 http:// 또는 https://로 시작해야 합니다.`);
    if (specUrl && !HTTP_URL.test(specUrl)) fail(`${label} 스웨거 주소는 http:// 또는 https://로 시작해야 합니다.`);
    urls.push({ ...u, baseUrl, specUrl });
  }
  return { endpoints, environments, urls };
};

const urlKey = (u: { endpointId: string; environmentId: string }): string => `${u.endpointId}/${u.environmentId}`;

const missingFrom = <T>(known: T[], input: T[], key: (row: T) => string): T[] => {
  const keys = new Set(input.map(key));
  return known.filter(row => !keys.has(key(row)));
};

/**
 * save_project_settings(p) 입력. 행은 DB 열 이름을 쓴다.
 * deleted = 마지막으로 읽었던 행 중 이번 입력에 없는 행. 읽은 뒤 다른 팀원이 추가한 행은 여기 없으므로
 * SQL이 충돌로 거절한다(모르는 행을 지우지 않는다).
 */
export const toSavePayload = (settings: ProjectSettings, known: ProjectSettings | null) => {
  const endpoint = (e: ProjectEndpoint) => ({ id: e.id, name: e.name, kind: e.kind, position: e.position, updated_at: e.updatedAt ?? null });
  const environment = (e: ProjectEnvironment) => ({ id: e.id, name: e.name, position: e.position, updated_at: e.updatedAt ?? null });
  const url = (u: ProjectEndpointUrl) => ({
    endpoint_id: u.endpointId,
    environment_id: u.environmentId,
    base_url: u.baseUrl,
    spec_url: u.specUrl,
    updated_at: u.updatedAt ?? null,
  });
  return {
    endpoints: settings.endpoints.map(endpoint),
    environments: settings.environments.map(environment),
    urls: settings.urls.map(url),
    deleted: {
      endpoints: missingFrom(known?.endpoints ?? [], settings.endpoints, e => e.id).map(endpoint),
      environments: missingFrom(known?.environments ?? [], settings.environments, e => e.id).map(environment),
      urls: missingFrom(known?.urls ?? [], settings.urls, urlKey).map(url),
    },
  };
};

export type EndpointRow = { id: string; name: string; kind: "web" | "api"; position: number; updated_at: string };
export type EnvironmentRow = { id: string; name: string; position: number; updated_at: string };
export type EndpointUrlRow = { endpoint_id: string; environment_id: string; base_url: string; spec_url: string | null; updated_at: string };

/** DB 행 → 화면 모양. 따로 읽는 사이에 지워진 엔드포인트·환경의 주소는 뺀다. */
export const fromRows = (endpoints: EndpointRow[], environments: EnvironmentRow[], urls: EndpointUrlRow[]): ProjectSettings => {
  const endpointIds = new Set(endpoints.map(e => e.id));
  const environmentIds = new Set(environments.map(e => e.id));
  return {
    endpoints: endpoints.map(e => ({ id: e.id, name: e.name, kind: e.kind, position: e.position, updatedAt: e.updated_at })),
    environments: environments.map(e => ({ id: e.id, name: e.name, position: e.position, updatedAt: e.updated_at })),
    urls: urls
      .filter(u => endpointIds.has(u.endpoint_id) && environmentIds.has(u.environment_id))
      .map(u => ({
        endpointId: u.endpoint_id,
        environmentId: u.environment_id,
        baseUrl: u.base_url,
        specUrl: u.spec_url,
        updatedAt: u.updated_at,
      })),
  };
};
