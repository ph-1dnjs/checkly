import type { ReactNode } from "react";
import type { ApiTestingBridge } from "../../../../app/api-testing/shared/workspace";
import { SensitiveValuesProvider } from "../../../entities/api-testing";
import { GlobalVariableAccessProvider, useGlobalVariableAccess } from "../../../features/api-testing/configure-globals";

type Props = { projectId: string; bridge: ApiTestingBridge; children: ReactNode };

function SensitiveValues({ projectId, bridge, children }: Props) {
  const { revision } = useGlobalVariableAccess();
  return <SensitiveValuesProvider projectId={projectId} bridge={bridge} revision={revision}>{children}</SensitiveValuesProvider>;
}

/** The page connects global editing notifications to secret-value display. */
export function ApiTestingProviders(props: Props) {
  return <GlobalVariableAccessProvider><SensitiveValues {...props} /></GlobalVariableAccessProvider>;
}
