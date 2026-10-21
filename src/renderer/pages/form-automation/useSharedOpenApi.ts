import { useEffect, useState } from "react";
import { loadSharedOpenApi, type SharedOpenApiSource } from "./sharedOpenApi";

export function useSharedOpenApi() {
  const [state, setState] = useState({ loading: true, projectName: "", sources: [] as SharedOpenApiSource[], errors: [] as string[] });
  const [reload, setReload] = useState({ revision: 0, refresh: false });
  useEffect(() => {
    let live = true;
    let busy = false;
    const load = async (refresh = false) => {
      if (busy) return;
      busy = true;
      setState(current => ({ ...current, loading: true }));
      const bridge = window.electronAPI?.apiTesting;
      try {
        const query = new URL(window.location.href).searchParams;
        const result = bridge ? await loadSharedOpenApi(bridge, query.get("project") || "", query.get("environment") || "", refresh)
          : { projectName: "", sources: [], errors: [] };
        if (live) setState({ ...result, loading: false });
      } catch (error) {
        if (live) setState(current => ({ ...current, loading: false, errors: [error instanceof Error ? error.message : String(error)] }));
      } finally { busy = false; }
    };
    void load(reload.refresh);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    const off = window.electronAPI?.auth?.onSessionChange?.(() => {
      live = false;
      setState({ loading: true, projectName: "", sources: [], errors: [] });
      setReload(current => ({ revision: current.revision + 1, refresh: false }));
    });
    return () => { live = false; off?.(); window.removeEventListener("focus", onFocus); };
  }, [reload]);
  return { ...state, refresh: () => setReload(current => ({ revision: current.revision + 1, refresh: true })) };
}
