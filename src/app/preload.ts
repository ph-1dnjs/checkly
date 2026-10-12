import { contextBridge } from 'electron'
import { apiTestingBridge } from './api-testing/bridge'
import { authBridge } from './ipc/auth/bridge'
import { formAutomationBridge } from './ipc/form-automation/bridge'
import { qaBridge } from './ipc/qa/bridge'
import { scenarioFileBridge } from './ipc/scenario-file/bridge'
import { updateBridge } from './ipc/update/bridge'
import { windowSettingsBridge } from './ipc/window-settings/bridge'

// 새 기능은 해당 도메인의 bridge.ts에 추가한다. 이 파일은 도메인을 새로 만들 때만 수정하며,
// 새 도메인은 펼치지 말고 apiTesting·windowSettings처럼 이름 공간으로 노출한다.
// bridge.ts는 preload에서 실행되므로 main 전용 모듈(index.ts 등)을 값으로 import하지 않는다.
contextBridge.exposeInMainWorld('electronAPI', {
  apiTesting: apiTestingBridge,
  auth: authBridge,
  windowSettings: windowSettingsBridge,
  ...updateBridge,
  ...scenarioFileBridge,
  ...qaBridge,
  ...formAutomationBridge,
})
