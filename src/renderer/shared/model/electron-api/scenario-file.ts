// src/app/ipc/scenario-file/bridge.ts 가 preload에서 노출하는 API.
export type ScenarioFileApi = {
  loadScenarioMarkdown: () => Promise<string | null>;
  saveScenarioMarkdown: (value: string) => Promise<void>;
  importScenarioFile: () => Promise<{
    markdown: string;
    filePath: string;
  } | null>;
  saveImportedScenarioFile: (value: string) => Promise<string | null>;
  exportScenarioFile: (value: string) => Promise<string | null>;
  selectUploadFile: () => Promise<string | null>;
  loadMarkerPositions: () => Promise<string | null>;
  saveMarkerPositions: (value: string) => Promise<void>;
  listScenarioFolder: () => Promise<{
    folderPath: string | null;
    files: Array<{ name: string; path: string; updatedAt: string }>;
  }>;
  chooseScenarioFolder: () => Promise<{
    folderPath: string | null;
    files: Array<{ name: string; path: string; updatedAt: string }>;
  }>;
  readScenarioFile: (filePath: string) => Promise<string | null>;
  openScenarioFile: (filePath: string) => Promise<{
    markdown: string;
    filePath: string;
  } | null>;
};
