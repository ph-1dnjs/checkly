export type NativeOverride = {
  id: string;
  clientId: string;
  name: string;
  match: string;
  method: string;
  status: number;
  enabled: boolean;
  body: unknown;
  sourceBody?: unknown;
  sourceUrl?: string;
};

export type NativeNetworkEvent = {
  id: string;
  type: "fetch";
  url: string;
  method: string;
  status: number;
  requestBody?: unknown;
  responseBody?: unknown;
  responseContentType?: string;
  elapsed: number;
  overridden: boolean;
  ruleRevision: number;
  error?: string;
  at: string;
  browserSessionId: string;
  browserSessionName: string;
};

export type NativeInspectorSnapshot = {
  running: boolean;
  port: number;
  revision: number;
  clients: Array<{ id: string; name: string; lastSeen: number; revision: number }>;
  events: NativeNetworkEvent[];
};

export type SimulatorDevice = { udid: string; name: string; state: string; runtime: string };
export type SimulatorApp = { bundleId: string; name: string };
export type SimulatorFrame = { udid: string; dataUrl: string; width: number; height: number };
export type SimulatorStatus = { udid: string | null; streaming: boolean; error: string };
export type SimulatorInput =
  | { type: "tap"; x: number; y: number }
  | { type: "swipe"; x: number; y: number; endX: number; endY: number }
  | { type: "text"; text: string }
  | { type: "key"; key: "ENTER" | "BACKSPACE" | "HOME" };
