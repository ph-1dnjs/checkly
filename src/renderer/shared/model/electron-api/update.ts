import type { UpdateStatus } from "../update";

// src/app/ipc/update/bridge.ts 가 preload에서 노출하는 API.
export type UpdateApi = {
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateStatus>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<void>;
  getUpdateSettings: () => Promise<{ autoCheck: boolean }>;
  setUpdateAutoCheck: (autoCheck: boolean) => Promise<void>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
};
