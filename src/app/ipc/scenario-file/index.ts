import { ipcMain } from "electron";
import type { MainDomain } from "../domain";
import {
  chooseScenarioFolder,
  exportScenarioFile,
  importScenarioFile,
  listScenarioFolder,
  loadMarkerPositions,
  loadScenarioMarkdown,
  openScenarioFile,
  readScenarioFile,
  saveImportedScenarioFile,
  saveMarkerPositions,
  saveScenarioMarkdown,
  selectUploadFile,
} from "./fileStorage";

export const scenarioFileDomain: MainDomain = {
  register: () => {
    ipcMain.handle("scenario:load", () => loadScenarioMarkdown());
    ipcMain.handle("scenario:save", (_event, markdown: string) =>
      saveScenarioMarkdown(markdown),
    );
    ipcMain.handle("scenario:import-file", () => importScenarioFile());
    ipcMain.handle("scenario:save-imported-file", (_event, markdown: string) =>
      saveImportedScenarioFile(markdown),
    );
    ipcMain.handle("scenario:export-file", (_event, markdown: string) =>
      exportScenarioFile(markdown),
    );
    ipcMain.handle("marker-positions:load", () => loadMarkerPositions());
    ipcMain.handle("marker-positions:save", (_event, positions: string) =>
      saveMarkerPositions(positions),
    );
    ipcMain.handle("scenario:list-folder", () => listScenarioFolder());
    ipcMain.handle("scenario:choose-folder", () => chooseScenarioFolder());
    ipcMain.handle("scenario:read-file", (_event, filePath: string) =>
      readScenarioFile(filePath),
    );
    ipcMain.handle("scenario:open-file", (_event, filePath: string) =>
      openScenarioFile(filePath),
    );
    // 채널은 qa: 이지만 파일 선택 대화상자라 구현이 있는 이 도메인에서 등록한다.
    ipcMain.handle("qa:select-upload-file", () => selectUploadFile());
  },
};
