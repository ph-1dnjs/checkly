export type QaStep = {
  id: string;
  action:
    | "goto"
    | "fill"
    | "fileUpload"
    | "manualFill"
    | "manualControl"
    | "manualResult"
    | "click"
    | "select"
    | "expectText";
  target: string;
  value?: string;
  required?: boolean;
  prompt?: string;
  condition?: string;
  waitSeconds?: number;
  occurrence?: number;
};
export type QaScenario = {
  id: string;
  title: string;
  url: string;
  steps: QaStep[];
};
export type QaRunOptions = { preview?: boolean; workerId?: string };
export type ManualResult = { status: "passed" | "failed"; reason?: string };
export type ManualControlResult = {
  status: "continue" | "failed";
  reason?: string;
};
export type ManualBrowserEvent = {
  type: "click" | "wheel" | "key" | "text";
  x?: number;
  y?: number;
  deltaY?: number;
  key?: string;
  text?: string;
};
