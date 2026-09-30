import type { ReactNode } from "react";
import type { ApiTestingBridge } from "../../../../app/api-testing/shared/workspace";
import { GlobalVariableAccessProvider } from "../../../features/api-testing/configure-globals";

type Props = { projectId: string; bridge: ApiTestingBridge; children: ReactNode };

/** Page-wide providers: global variable editing requests from anywhere on the page. */
export function ApiTestingProviders({ children }: Props) {
  return <GlobalVariableAccessProvider>{children}</GlobalVariableAccessProvider>;
}
