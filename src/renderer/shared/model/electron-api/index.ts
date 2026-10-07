import type { WindowSettingsBridge } from "../windowSettings";
import type { ApiTestingBridge } from "../../../../app/api-testing/shared/workspace";
import type { AuthBridge } from "./auth";
import type { FormAutomationApi } from "./form-automation";
import type { QaApi } from "./qa";
import type { ScenarioFileApi } from "./scenario-file";
import type { UpdateApi } from "./update";

export {};

// 기능 타입은 도메인 파일에 추가한다. 이 파일은 도메인을 새로 만들 때만 수정한다.
export type ElectronAPI = {
  apiTesting: ApiTestingBridge;
  auth: AuthBridge;
  windowSettings: WindowSettingsBridge;
} & UpdateApi &
  ScenarioFileApi &
  QaApi &
  FormAutomationApi;

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
