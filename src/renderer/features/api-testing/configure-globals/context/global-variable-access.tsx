import { createContext, useContext, useState, type ReactNode } from "react";

const Access = createContext({ open: (_name: string) => {}, name: "", request: 0, revision: 0, saved: () => {} });
export const useGlobalVariableAccess = () => useContext(Access);

export function GlobalVariableAccessProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState({ name: "", request: 0 });
  const [revision, setRevision] = useState(0);
  return <Access.Provider value={{ ...target, revision, open: name => setTarget(previous => ({ name, request: previous.request + 1 })), saved: () => setRevision(previous => previous + 1) }}>{children}</Access.Provider>;
}
