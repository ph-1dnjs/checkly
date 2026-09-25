import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ApiTestingBridge } from "../../../app/api-testing/shared/workspace";
import { isSensitiveKey } from "../../../app/api-testing/shared/sensitive";
import { useGlobalVariableAccess } from "./global-variable-access";

const SensitiveValues = createContext<{ known: string[]; refresh: () => void }>({ known: [], refresh: () => {} });

/** Known secret values for display masking: string globals whose names look sensitive. */
export const useSensitiveValues = () => useContext(SensitiveValues);

export function SensitiveValuesProvider({ projectId, bridge, children }: { projectId: string; bridge: ApiTestingBridge; children: ReactNode }) {
  const { revision } = useGlobalVariableAccess();
  const [known, setKnown] = useState<string[]>([]);
  const [request, setRequest] = useState(0);
  const refresh = useCallback(() => setRequest(value => value + 1), []);
  useEffect(() => {
    if (!projectId) { setKnown([]); return; }
    let live = true;
    void bridge.listGlobals({ projectId })
      .then(items => { if (live) setKnown(items.filter(item => item.type === "string" && isSensitiveKey(item.name)).map(item => item.displayValue)); })
      .catch(() => {});
    return () => { live = false; };
  }, [bridge, projectId, revision, request]);
  return <SensitiveValues.Provider value={{ known, refresh }}>{children}</SensitiveValues.Provider>;
}
