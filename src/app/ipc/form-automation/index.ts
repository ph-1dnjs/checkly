import { ipcMain } from "electron";
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

export const formAutomationDomain: MainDomain = {
  register: () => {
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
