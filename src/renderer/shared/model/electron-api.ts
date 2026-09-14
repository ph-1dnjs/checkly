import type { RunProgress, Scenario, Step } from "./scenario";
import type { UpdateStatus } from "./update";
import type { ApiTestingBridge } from "../../../app/api-testing/shared/workspace";

export {};

declare global {
  interface Window {
    electronAPI: {
      apiTesting: ApiTestingBridge;
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
      insertFormAutomationText: (input: {
        webContentsId: number;
        text: string;
      }) => Promise<void>;
      attachFormAutomationFixture: (input: {
        webContentsId: number;
        token: string;
        valid: boolean;
        accept: string;
        multiple: boolean;
      }) => Promise<void>;
      captureFormAutomationPage: () => Promise<{
        dataUrl: string;
        size: { width: number; height: number };
      }>;
      copyFormAutomationImage: (dataUrl: string) => Promise<boolean>;
      copyFormAutomationText: (text: string) => Promise<boolean>;
      saveFormAutomationSessionEvent: (payload: unknown) => Promise<boolean>;
      readFormAutomationSessionEvents: (limit?: number) => Promise<unknown[]>;
      clearFormAutomationSessionEvents: () => Promise<boolean>;
      exportFormAutomationSessionEvents: () => Promise<{
        filePath: string;
        count: number;
        errorCount: number;
        format: "xlsx";
      } | null>;
      requestFormAutomationUrl: (input: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        timeout?: number;
      }) => Promise<{
        ok: boolean;
        status: number;
        statusText: string;
        text: string;
        elapsed: number;
        url: string;
      }>;
      pickFormAutomationOpenApi: () => Promise<{
        filePath: string;
        text: string;
      } | null>;
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
