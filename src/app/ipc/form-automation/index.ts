import { app, ipcMain } from "electron";
import path from "node:path";
import type { MainDomain } from "../domain";
import {
  appendFormAutomationSessionEvent,
  attachFormAutomationFixture,
  captureFormAutomationPage,
  clearFormAutomationSessionEvents,
  copyFormAutomationImage,
  copyFormAutomationText,
  exportFormAutomationSessionEvents,
  insertFormAutomationText,
  pickFormAutomationOpenApi,
  readFormAutomationSessionEvents,
  requestFormAutomationUrl,
  type FormAutomationFixtureInput,
  type FormAutomationTextInput,
} from "./formAutomation";
import { attachFormAutomationWebviews } from "./webview";
import { FormAutomationStorage } from "./storage";
import type { FormAutomationStorageKey } from "./storageTypes";

export const formAutomationDomain: MainDomain = {
  register: () => {
    const storage = new FormAutomationStorage(path.join(app.getPath("userData"), "form-automation-state.json"));
    ipcMain.handle("form-automation:load-state", (_event, legacy: unknown) => storage.load(legacy));
    ipcMain.handle("form-automation:set-state", (_event, key: FormAutomationStorageKey, value: unknown) => storage.set(key, value));
    ipcMain.handle(
      "form-automation:insert-text",
      (_event, input: FormAutomationTextInput) => insertFormAutomationText(input),
    );
    ipcMain.handle(
      "form-automation:attach-fixture",
      (_event, input: FormAutomationFixtureInput) =>
        attachFormAutomationFixture(input),
    );
    ipcMain.handle("form-automation:capture-page", (event) =>
      captureFormAutomationPage(event.sender),
    );
    ipcMain.handle("form-automation:copy-image", (_event, dataUrl: string) =>
      copyFormAutomationImage(dataUrl),
    );
    ipcMain.handle("form-automation:copy-text", (_event, text: string) =>
      copyFormAutomationText(text),
    );
    ipcMain.handle("form-automation:save-session-event", (_event, payload: Record<string, unknown>) =>
      appendFormAutomationSessionEvent(payload),
    );
    ipcMain.handle("form-automation:read-session-events", (_event, limit?: number) =>
      readFormAutomationSessionEvents(limit),
    );
    ipcMain.handle("form-automation:clear-session-events", () =>
      clearFormAutomationSessionEvents(),
    );
    ipcMain.handle("form-automation:export-session-events", () =>
      exportFormAutomationSessionEvents(),
    );
    ipcMain.handle("form-automation:http-request", (_event, input) =>
      requestFormAutomationUrl(input),
    );
    ipcMain.handle("form-automation:pick-openapi", () => pickFormAutomationOpenApi());
  },
  attachWindow: attachFormAutomationWebviews,
};
