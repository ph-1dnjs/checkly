import { BrowserWindow, ipcMain } from "electron";
import type { MainDomain } from "../domain";
import {
  cancelActiveRun,
  controlManualBrowser,
  executeScenario,
  finishQaWorker,
  inspectScenario,
  resolveManualControl,
  resolveManualInput,
  resolveManualResult,
  setQaViewport,
  shutdownScenarioWorker,
} from "./qaExecution";
import type {
  ManualBrowserEvent,
  ManualControlResult,
  ManualResult,
  QaRunOptions,
  QaScenario,
} from "./qaTypes";
import { downloadRunVideo, mergeRunVideos } from "./video";

export const qaDomain: MainDomain = {
  register: () => {
    ipcMain.handle(
      "qa:start",
      async (event, scenario: QaScenario, options: QaRunOptions) =>
        executeScenario(
          scenario,
          BrowserWindow.fromWebContents(event.sender)!,
          options,
        ),
    );
    ipcMain.handle("qa:finish-worker", (_event, workerId: string) =>
      finishQaWorker(workerId),
    );
    ipcMain.handle("qa:inspect", (_event, scenario: QaScenario) =>
      inspectScenario(scenario),
    );
    ipcMain.handle("qa:download-run-video", (_event, filePath: string) =>
      downloadRunVideo(filePath),
    );
    ipcMain.handle("qa:merge-run-videos", (_event, filePaths: string[]) =>
      mergeRunVideos(filePaths),
    );
    ipcMain.handle("qa:manual-input", (_event, value: string) =>
      resolveManualInput(value),
    );
    ipcMain.handle("qa:manual-control", (_event, result: ManualControlResult) =>
      resolveManualControl(result),
    );
    ipcMain.handle(
      "qa:manual-browser-event",
      (_event, event: ManualBrowserEvent) => controlManualBrowser(event),
    );
    ipcMain.handle(
      "qa:set-viewport",
      (_event, size: { width: number; height: number }) => setQaViewport(size),
    );
    ipcMain.handle("qa:manual-result", (_event, result: ManualResult) =>
      resolveManualResult(result),
    );
    ipcMain.handle(
      "qa:cancel",
      (_event, options?: { keepWorker?: boolean }) =>
        cancelActiveRun(options),
    );
  },
  beforeQuit: () => {
    void shutdownScenarioWorker();
  },
};
