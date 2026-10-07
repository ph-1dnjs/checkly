// src/app/ipc/form-automation/bridge.ts 가 preload에서 노출하는 API.
export type FormAutomationApi = {
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
};
