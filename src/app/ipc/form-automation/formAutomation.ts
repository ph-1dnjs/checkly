import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  type WebContents,
  webContents,
} from "electron";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFormAutomationWorkbook } from "./formAutomationReport";

export type FormAutomationTextInput = {
  webContentsId: number;
  text: string;
};

export type FormAutomationFixtureInput = {
  webContentsId: number;
  token: string;
  valid: boolean;
  accept: string;
  multiple: boolean;
};

type FormAutomationRequestInput = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
};

const sessionLogPath = () =>
  path.join(app.getPath("userData"), "form-automation-session-events.jsonl");

export const appendFormAutomationSessionEvent = async (
  payload: Record<string, unknown>,
): Promise<boolean> => {
  await mkdir(path.dirname(sessionLogPath()), { recursive: true });
  await appendFile(sessionLogPath(), `${JSON.stringify(payload)}\n`, "utf8");
  return true;
};

export const readFormAutomationSessionEvents = async (limit = 1000) => {
  try {
    const text = await readFile(sessionLogPath(), "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .slice(-Math.min(Math.max(Number(limit) || 1000, 1), 5000))
      .reverse()
      .flatMap((line) => {
        try { return [JSON.parse(line) as Record<string, unknown>]; }
        catch { return []; }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

export const clearFormAutomationSessionEvents = async (): Promise<boolean> => {
  await mkdir(path.dirname(sessionLogPath()), { recursive: true });
  await writeFile(sessionLogPath(), "", "utf8");
  return true;
};

export const exportFormAutomationSessionEvents = async () => {
  const events = (await readFormAutomationSessionEvents(5000)).reverse();
  const result = await dialog.showSaveDialog({
    title: "폼 자동 완성 네트워크·오류 기록 저장",
    defaultPath: `checkly-form-network-log-${new Date().toISOString().slice(0, 10)}.xlsx`,
    filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const exported = await createFormAutomationWorkbook(events);
  await writeFile(result.filePath, exported.buffer);
  return {
    filePath: result.filePath,
    count: exported.count,
    errorCount: exported.errorCount,
    format: "xlsx" as const,
  };
};

export const captureFormAutomationPage = async (sender: WebContents) => {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) throw new Error("캡처할 Checkly 창을 찾지 못했습니다.");
  const image = await window.webContents.capturePage();
  if (image.isEmpty()) throw new Error("화면 캡처 결과가 비어 있습니다.");
  return { dataUrl: image.toDataURL(), size: image.getSize() };
};

export const copyFormAutomationImage = (dataUrl: string): boolean => {
  if (!String(dataUrl || "").startsWith("data:image/png;base64,"))
    throw new Error("PNG 캡처 이미지만 복사할 수 있습니다.");
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("클립보드에 복사할 이미지가 비어 있습니다.");
  clipboard.writeImage(image);
  return true;
};

export const copyFormAutomationText = (text: string): boolean => {
  clipboard.writeText(String(text || ""));
  return true;
};

export const requestFormAutomationUrl = async ({
  url,
  method = "GET",
  headers = {},
  body,
  timeout = 20000,
}: FormAutomationRequestInput) => {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error("올바른 Swagger/OpenAPI URL을 입력해 주세요."); }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error("http 또는 https 주소만 호출할 수 있습니다.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(timeout, 1000), 60000));
  const startedAt = Date.now();
  try {
    const response = await fetch(parsed, {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method.toUpperCase()) ? undefined : body,
      signal: controller.signal,
      redirect: "follow",
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      text: await response.text(),
      elapsed: Date.now() - startedAt,
      url: response.url,
    };
  } finally {
    clearTimeout(timer);
  }
};

export const pickFormAutomationOpenApi = async () => {
  const result = await dialog.showOpenDialog({
    title: "Swagger/OpenAPI JSON 선택",
    properties: ["openFile"],
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  return { filePath, text: await readFile(filePath, "utf8") };
};

const formWebviewFor = (webContentsId: number) => {
  const target = webContents.fromId(Number(webContentsId));
  if (!target || target.isDestroyed() || target.getType() !== "webview")
    throw new Error("자동 입력 대상 웹뷰를 찾지 못했습니다.");
  return target;
};

export const insertFormAutomationText = async ({
  webContentsId,
  text,
}: FormAutomationTextInput): Promise<void> => {
  const target = formWebviewFor(webContentsId);
  target.focus();
  target.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
  target.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
  if (text) await target.insertText(String(text));
};

const fixtureDefinition = (accept: string, valid: boolean) => {
  if (!valid)
    return {
      extension: "exe",
      content: Buffer.from("Checkly invalid file fixture\n"),
    };
  const tokens = accept.toLowerCase().split(",").map((token) => token.trim()).filter(Boolean);
  const has = (...values: string[]) =>
    values.some((value) => tokens.some((token) => token === value || token.includes(value)));
  if (has(".png", "image/png", "image/*"))
    return {
      extension: "png",
      content: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    };
  if (has(".pdf", "application/pdf"))
    return {
      extension: "pdf",
      content: Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
      ),
    };
  if (has(".json", "application/json"))
    return {
      extension: "json",
      content: Buffer.from('{"checkly":true,"case":"valid-file"}\n'),
    };
  if (has(".csv", "text/csv"))
    return { extension: "csv", content: Buffer.from("id,name\n1,Checkly\n") };
  if (has(".jpg", ".jpeg", "image/jpeg"))
    return {
      extension: "jpg",
      content: Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
        "base64",
      ),
    };
  if (has(".docx"))
    return { extension: "docx", content: Buffer.from("Checkly DOCX fixture\n") };
  if (has(".doc"))
    return { extension: "doc", content: Buffer.from("Checkly DOC fixture\n") };
  if (has(".xlsx"))
    return { extension: "xlsx", content: Buffer.from("Checkly XLSX fixture\n") };
  return { extension: "txt", content: Buffer.from("Checkly valid file fixture\n") };
};

const createFixtureFiles = async ({
  accept,
  valid,
  multiple,
}: Pick<FormAutomationFixtureInput, "accept" | "valid" | "multiple">) => {
  const definition = fixtureDefinition(String(accept || ""), valid !== false);
  const directory = path.join(app.getPath("temp"), "checkly-form-fixtures");
  await mkdir(directory, { recursive: true });
  const count = multiple ? 2 : 1;
  const files: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = count > 1 ? `-${index + 1}` : "";
    const filePath = path.join(
      directory,
      `checkly-${valid ? "valid" : "invalid"}${suffix}.${definition.extension}`,
    );
    await writeFile(filePath, definition.content);
    files.push(filePath);
  }
  return files;
};

export const attachFormAutomationFixture = async (
  input: FormAutomationFixtureInput,
): Promise<void> => {
  if (!/^qa-file-[a-z0-9-]+$/i.test(String(input.token || "")))
    throw new Error("유효하지 않은 파일 입력 토큰입니다.");
  const target = formWebviewFor(input.webContentsId);
  const files = await createFixtureFiles(input);
  const ownsDebugger = !target.debugger.isAttached();
  if (ownsDebugger) target.debugger.attach("1.3");
  const objectGroup = `checkly-form-file-${Date.now()}`;
  try {
    const evaluation = await target.debugger.sendCommand("Runtime.evaluate", {
      expression: `Array.from(document.querySelectorAll('[data-qa-file-token]')).find((element) => element.getAttribute('data-qa-file-token') === ${JSON.stringify(input.token)})`,
      objectGroup,
    });
    const objectId = evaluation.result?.objectId;
    if (!objectId) throw new Error("대상 파일 input을 찾지 못했습니다.");
    await target.debugger.sendCommand("DOM.setFileInputFiles", {
      files,
      objectId,
    });
    await target.executeJavaScript(`(() => {
      const input = Array.from(document.querySelectorAll('[data-qa-file-token]')).find((element) => element.getAttribute('data-qa-file-token') === ${JSON.stringify(input.token)});
      if (!input) return false;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    })()`);
  } finally {
    try {
      await target.debugger.sendCommand("Runtime.releaseObjectGroup", {
        objectGroup,
      });
    } catch {
      /* 이미 정리된 디버거 객체는 무시한다. */
    }
    if (ownsDebugger && target.debugger.isAttached()) target.debugger.detach();
  }
};
