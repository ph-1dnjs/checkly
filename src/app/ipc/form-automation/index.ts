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
  saveReactNativeModule,
  requestFormAutomationUrl,
  type FormAutomationFixtureInput,
  type FormAutomationTextInput,
} from "./formAutomation";
import { attachFormAutomationWebviews } from "./webview";
import { FormAutomationStorage } from "./storage";
import type { FormAutomationStorageKey } from "./storageTypes";
import { NativeInspector } from "./nativeInspector";
import { SimulatorService } from "./simulator";
import type { SimulatorInput } from "./nativeInspectorTypes";

const nativeInspector = new NativeInspector();
const simulator = new SimulatorService();

export const formAutomationDomain: MainDomain = {
  register: () => {
    ipcMain.handle("form-automation:native-save-module", () => saveReactNativeModule());
    ipcMain.handle("form-automation:simulator-devices", () => simulator.devices());
    ipcMain.handle("form-automation:simulator-apps", (_event, udid: string) => simulator.apps(udid));
    ipcMain.handle("form-automation:simulator-status", () => simulator.snapshot());
    ipcMain.handle("form-automation:simulator-connect", (event, udid: string) => simulator.connect(udid, frame => {
      if (!event.sender.isDestroyed()) event.sender.send("form-automation:simulator-frame", frame);
    }));
    ipcMain.handle("form-automation:simulator-disconnect", () => simulator.disconnect());
    ipcMain.handle("form-automation:simulator-launch", (_event, udid: string, bundleId: string, restart?: boolean) => simulator.launch(udid, bundleId, restart === true));
    ipcMain.handle("form-automation:simulator-input", (_event, udid: string, input: SimulatorInput) => simulator.input(udid, input));
    ipcMain.handle("form-automation:native-snapshot", () => nativeInspector.snapshot());
    ipcMain.handle("form-automation:native-start", (_event, rules: unknown) => {
      nativeInspector.setRules(rules);
      return nativeInspector.start();
    });
    ipcMain.handle("form-automation:native-stop", () => nativeInspector.stop());
    ipcMain.handle("form-automation:native-rules", (_event, rules: unknown) => nativeInspector.setRules(rules));
    ipcMain.handle("form-automation:native-clear", () => nativeInspector.clearEvents());
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
  attachWindow: (window) => {
    attachFormAutomationWebviews(window);
    window.on("closed", () => { simulator.disconnect(); void nativeInspector.stop(); });
  },
  beforeQuit: () => { simulator.disconnect(); void nativeInspector.stop(); },
};
