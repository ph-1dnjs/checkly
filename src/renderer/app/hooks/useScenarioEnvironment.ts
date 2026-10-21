import { useEffect, useState } from "react";
import type { ProjectSettings } from "../../../app/ipc/auth/types";
import { resolveScenarioUrl, type Scenario } from "../../shared/model/scenario";

/** 환경만 개인별로 고르고, 웹 엔드포인트는 시나리오 본문의 `endpoint:` ID로 설정의 주소와 연결한다. */
export const useScenarioEnvironment = (projectId: string | undefined, showToast: (message: string) => void) => {
  const [settings, setSettings] = useState<ProjectSettings>({ endpoints: [], environments: [], urls: [] });
  const key = `web-scenario-environment:${projectId}`;
  const [selection, setSelection] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
  });
  const refresh = async () => {
    if (!projectId) return;
    try { setSettings(await window.electronAPI.auth.getProjectSettings()); }
    catch (error) { showToast(error instanceof Error ? error.message : "환경 설정을 불러오지 못했습니다."); }
  };
  useEffect(() => { void refresh(); }, [projectId]);
  const endpoints = settings.endpoints.filter(item => item.kind === "web");
  const defaultEndpointId = endpoints[0]?.id ?? "";
  const environmentId = settings.environments.some(item => item.id === selection.environmentId) ? selection.environmentId : settings.environments[0]?.id ?? "";
  // `endpoint:`가 없는 이전 문서는 첫 웹 엔드포인트를 쓴다. 지워진 ID는 주소 없음으로 본다.
  const endpointFor = (endpointId?: string) => endpointId ? endpoints.find(item => item.id === endpointId) : endpoints[0];
  const baseUrlFor = (endpointId?: string) => {
    const endpoint = endpointFor(endpointId);
    return settings.urls.find(item => item.endpointId === endpoint?.id && item.environmentId === environmentId)?.baseUrl ?? "";
  };
  const select = (next: { environmentId: string }) => {
    setSelection(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const resolve = (items: Scenario[]): Scenario[] | null => {
    const missing = items.find(item => !baseUrlFor(item.endpointId));
    if (missing) {
      showToast(endpointFor(missing.endpointId)
        ? `'${missing.title}'의 웹 엔드포인트에 선택한 환경의 주소를 설정에서 넣어 주세요.`
        : `'${missing.title}'의 웹 엔드포인트를 설정에서 찾을 수 없습니다. 시나리오의 엔드포인트를 다시 선택하세요.`);
      return null;
    }
    try {
      return items.map(item => resolveScenarioUrl(item, baseUrlFor(item.endpointId)));
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
  return { endpoints, environments: settings.environments, menuProject, defaultEndpointId, environmentId, baseUrlFor, select, resolve, refresh };
};
