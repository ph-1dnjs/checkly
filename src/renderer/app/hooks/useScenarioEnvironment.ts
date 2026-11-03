import { useEffect, useState } from "react";
import type { ProjectSettings } from "../../../app/ipc/auth/types";
import { resolveScenarioUrl, type Scenario } from "../../shared/model/scenario";

/** 헤더에서 고른 웹 엔드포인트(서버)와 환경. 시나리오 본문에는 `endpoint:`·`environment:`로 저장한다. */
export type ScenarioTarget = { endpointId: string; environmentId: string };

/** 헤더의 서버·환경 선택을 프로젝트별 개인 설정으로 기억하고, 설정의 주소와 연결한다. 고르지 않았으면 첫 서버·환경을 쓴다. */
export const useScenarioEnvironment = (projectId: string | undefined, showToast: (message: string) => void) => {
  const [settings, setSettings] = useState<ProjectSettings>({ endpoints: [], environments: [], urls: [] });
  const key = `web-scenario-environment:${projectId}`;
  const [selection, setSelection] = useState<Partial<ScenarioTarget>>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
  });
  const refresh = async () => {
    if (!projectId) return;
    try { setSettings(await window.electronAPI.auth.getProjectSettings()); }
    catch (error) { showToast(error instanceof Error ? error.message : "환경 설정을 불러오지 못했습니다."); }
  };
  useEffect(() => { void refresh(); }, [projectId]);
  const endpoints = settings.endpoints.filter(item => item.kind === "web");
  const endpointId = endpoints.some(item => item.id === selection.endpointId) ? selection.endpointId! : endpoints[0]?.id ?? "";
  const environmentId = settings.environments.some(item => item.id === selection.environmentId) ? selection.environmentId! : settings.environments[0]?.id ?? "";
  // `endpoint:`가 없거나 설정에서 지워진 서버의 문서는 첫 서버의 문서로 본다.
  const endpointOf = (scenario?: Pick<Scenario, "endpointId">) =>
    endpoints.some(item => item.id === scenario?.endpointId) ? scenario!.endpointId! : endpoints[0]?.id ?? "";
  const baseUrlFor = (id = endpointId) =>
    settings.urls.find(item => item.endpointId === id && item.environmentId === environmentId)?.baseUrl ?? "";
  /** 바꾼 값만 넘긴다. 설정에 없는 id는 무시한다. */
  const select = (next: Partial<ScenarioTarget>) => {
    const valid = {
      ...(next.endpointId && endpoints.some(item => item.id === next.endpointId) ? { endpointId: next.endpointId } : {}),
      ...(next.environmentId && settings.environments.some(item => item.id === next.environmentId) ? { environmentId: next.environmentId } : {}),
    };
    const merged = { endpointId, environmentId, ...valid };
    setSelection(merged);
    localStorage.setItem(key, JSON.stringify(merged));
    return merged;
  };
  /** 헤더의 서버·환경 주소로 시작 주소를 정한다. */
  const resolve = (source: Scenario[]): Scenario[] | null => {
    const endpoint = endpoints.find(item => item.id === endpointId);
    const baseUrl = baseUrlFor();
    if (!endpoint || !baseUrl) {
      showToast(endpoint ? `'${endpoint.name}' 서버에 선택한 환경의 주소를 설정에서 넣어 주세요.` : "설정에서 웹 엔드포인트를 추가해 주세요.");
      return null;
    }
    try {
      return source.map(item => resolveScenarioUrl({ ...item, endpointId, environmentId }, baseUrl));
    } catch { showToast("설정의 웹 주소를 확인하세요."); return null; }
  };
  // 환경 메뉴(EnvironmentMenu)용: 웹 엔드포인트를 서버로, 환경마다 엔드포인트별 주소를 보여 준다.
  const menuProject = {
    environments: settings.environments.map(environment => ({
      id: environment.id,
      name: environment.name,
      baseUrls: Object.fromEntries(endpoints.map(endpoint => [
        endpoint.id,
        settings.urls.find(item => item.endpointId === endpoint.id && item.environmentId === environment.id)?.baseUrl ?? "",
      ])),
    })),
    servers: endpoints.map(endpoint => ({ id: endpoint.id, name: endpoint.name })),
  };
  return { endpoints, environments: settings.environments, menuProject, endpointId, environmentId, endpointOf, baseUrlFor, select, resolve, refresh };
};
