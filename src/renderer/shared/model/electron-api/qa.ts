import type { RunProgress, Scenario, Step } from "../scenario";

// src/app/ipc/qa/bridge.ts 가 preload에서 노출하는 API.
export type QaApi = {
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
  cancelQa: (options?: { keepWorker?: boolean }) => Promise<void>;
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
