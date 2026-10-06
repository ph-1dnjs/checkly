import type { MainDomain } from "../domain";
import {
  applyInitialWindowState,
  registerWindowSettingsIpc,
} from "./windowSettings";

// 창 생성자 옵션은 도메인 훅으로 표현할 수 없어 main.ts가 직접 가져다 쓴다.
export { loadInitialWindowOptions } from "./windowSettings";

export const windowSettingsDomain: MainDomain = {
  register: registerWindowSettingsIpc,
  attachWindow: applyInitialWindowState,
};
