import { useCallback, useEffect, useState } from "react";
import {
  isScenarioWorkspaceRoute,
  type Route,
  type ScenarioRunRoute,
  type ScenarioWorkspaceRoute,
} from "../../shared/model/scenario";

export type UseNavigationResult = {
  route: Route;
  setRoute: (route: Route) => void;
  /** 시나리오 작업공간(편집·실행)에서 마지막으로 본 화면. dock 진입 시 복귀한다. */
  lastWorkspaceRoute: ScenarioWorkspaceRoute;
  /** 실행 탭에서 마지막으로 본 하위 화면(대상 선택 · 실행 현황). */
  lastRunRoute: ScenarioRunRoute;
  toast: string;
  showToast: (message: string) => void;
};

export const useNavigation = (): UseNavigationResult => {
  const [route, setRouteState] = useState<Route>("dashboard");
  const [lastWorkspaceRoute, setLastWorkspaceRoute] =
    useState<ScenarioWorkspaceRoute>("picker");
  const [lastRunRoute, setLastRunRoute] = useState<ScenarioRunRoute>("picker");
  const [toast, setToast] = useState("");

  const setRoute = useCallback((next: Route) => {
    setRouteState(next);
    if (!isScenarioWorkspaceRoute(next)) return;
    setLastWorkspaceRoute(next);
    if (next !== "editor") setLastRunRoute(next);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return {
    route,
    setRoute,
    lastWorkspaceRoute,
    lastRunRoute,
    toast,
    showToast: setToast,
  };
};
