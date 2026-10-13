import { useEffect, useState } from "react";
import type { ProjectSettings } from "../../../app/ipc/auth/types";
import type { Scenario } from "../../shared/model/scenario";

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
  const endpointId = endpoints.some(item => item.id === selection.endpointId) ? selection.endpointId : endpoints[0]?.id ?? "";
  const environmentId = settings.environments.some(item => item.id === selection.environmentId) ? selection.environmentId : settings.environments[0]?.id ?? "";
  const baseUrl = settings.urls.find(item => item.endpointId === endpointId && item.environmentId === environmentId)?.baseUrl ?? "";
  const select = (next: { endpointId?: string; environmentId?: string }) => {
    const value = { endpointId, environmentId, ...next };
    setSelection(value);
    localStorage.setItem(key, JSON.stringify(value));
  };
  const resolve = (items: Scenario[]): Scenario[] | null => {
    if (!baseUrl) { showToast("설정에서 웹 엔드포인트와 선택한 환경의 주소를 넣어 주세요."); return null; }
    try {
      return items.map(item => ({ ...item, url: new URL(item.url || "/", baseUrl).href }));
    } catch { showToast("시나리오 경로 또는 설정의 웹 주소를 확인하세요."); return null; }
  };
  return { endpoints, environments: settings.environments, endpointId, environmentId, baseUrl, select, resolve, refresh };
};
