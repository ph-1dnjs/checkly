import { useEffect, useState } from "react";
import type { Route } from "../../shared/model/scenario";

export type UseNavigationResult = {
  route: Route;
  setRoute: (route: Route) => void;
  toast: string;
  showToast: (message: string) => void;
};

export const useNavigation = (): UseNavigationResult => {
  const [route, setRoute] = useState<Route>("dashboard");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return { route, setRoute, toast, showToast: setToast };
};
