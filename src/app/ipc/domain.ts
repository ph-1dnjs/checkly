import type { BrowserWindow } from "electron";

// main 프로세스의 기능 도메인. main.ts는 도메인 목록만 알고, 도메인 안의 IPC 등록·창 연결·종료 처리는
// 각 도메인의 index.ts가 맡는다. 도메인에 기능을 추가할 때는 해당 index.ts만 수정한다.
export type MainDomain = {
  // app ready 직후, 첫 창을 만들기 전에 한 번 호출한다 (ipcMain.handle 등록).
  register?: () => void;
  // 창을 만들 때마다 페이지를 불러오기 전에 호출한다 (webContents 이벤트 연결 등).
  attachWindow?: (window: BrowserWindow) => void | Promise<void>;
  // 첫 창을 만든 뒤 한 번 호출한다 (백그라운드 작업 시작).
  start?: () => void;
  // 앱 종료 직전에 호출한다.
  beforeQuit?: () => void;
};
