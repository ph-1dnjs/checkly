import { createContext, useContext, useState, type ReactNode } from "react";
import { Popover } from "../../shared/ui/Popover";
import { GlobalVariablesPanel } from "./GlobalVariablesPanel";
import type { ApiTestingBridge } from "../../../app/api-testing/shared/workspace";

const Access = createContext({ open: (_name: string) => {}, name: "", request: 0, revision: 0, saved: () => {} });
export const useGlobalVariableAccess = () => useContext(Access);

export function GlobalVariableAccessProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState({ name: "", request: 0 });
  const [revision, setRevision] = useState(0);
  return <Access.Provider value={{ ...target, revision, open: name => setTarget(previous => ({ name, request: previous.request + 1 })), saved: () => setRevision(previous => previous + 1) }}>{children}</Access.Provider>;
}

export function GlobalVariableMenu({ projectId, bridge, disabled }: { projectId: string; bridge: ApiTestingBridge; disabled: boolean }) {
  const access = useGlobalVariableAccess();
  return <Popover label="{ } 전역변수" disabled={disabled} openRequest={access.request}>
    <GlobalVariablesPanel scope={{ projectId }} bridge={bridge} targetName={access.name} targetRequest={access.request} onSaved={access.saved} />
  </Popover>;
}

export function GlobalVariableSetupLink({ name }: { name: string }) {
  const access = useGlobalVariableAccess();
  return <button type="button" className="api-global-variable-setup-link" title={`${name} 전역변수 설정`} aria-label={`${name} 전역변수 설정하기`} onClick={event => { event.stopPropagation(); access.open(name); }}>설정하기</button>;
}
