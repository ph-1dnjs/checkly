import type { RunProgress, Scenario, Step } from "./scenario";
import type { UpdateStatus } from "./update";

export {};

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      checkForUpdates: () => Promise<UpdateStatus>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<void>;
      getUpdateSettings: () => Promise<{ autoCheck: boolean }>;
      setUpdateAutoCheck: (autoCheck: boolean) => Promise<void>;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
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
      inspectScenario: (
        value: Scenario,
      ) => Promise<Array<{ id: string; connected: boolean }>>;
      runQa: (
        value: Scenario,
        options?: { preview?: boolean; workerId?: string },
      ) => Promise<{ status: string; log: string[] }>;
      finishQaWorker: (workerId: string) => Promise<void>;
      downloadRunVideo: (value: string) => Promise<string | null>;
      mergeRunVideos: (values: string[]) => Promise<string | null>;
      submitManualInput: (value: string) => Promise<void>;
      submitManualControl: (result: {
        status: "continue" | "failed";
        reason?: string;
      }) => Promise<void>;
      controlManualBrowser: (event: {
        type: "click" | "wheel" | "key" | "text";
        x?: number;
        y?: number;
        deltaY?: number;
        key?: string;
        text?: string;
      }) => Promise<void>;
      setQaViewport: (size: { width: number; height: number }) => Promise<void>;
      submitManualResult: (result: {
        status: "passed" | "failed";
        reason?: string;
      }) => Promise<void>;
      cancelQa: () => Promise<void>;
      onManualInputRequired: (callback: (value: Step) => void) => () => void;
      onManualControlRequired: (
        callback: (value: Step & { timeoutSeconds?: number }) => void,
      ) => () => void;
      onManualResultRequired: (
        callback: (value: Step & { timeoutSeconds?: number }) => void,
      ) => () => void;
      onQaProgress: (callback: (value: RunProgress) => void) => () => void;
      onQaPreview: (callback: (value: string) => void) => () => void;
      onQaStepPreview: (
        callback: (value: {
          scenarioId: string;
          stepId: string;
          image: string;
        }) => void,
      ) => () => void;
      onRunVideo: (callback: (value: string | null) => void) => () => void;
    };
  }
}
