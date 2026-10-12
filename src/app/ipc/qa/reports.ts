import { app, BrowserWindow, dialog } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QaScenario } from "./qaTypes";

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

export const writeRunReport = async (
  scenario: QaScenario,
  status: string,
  log: string[],
): Promise<string> => {
  const runId = `run-${Date.now()}`;
  const directory = path.join(app.getPath("userData"), "reports", runId);
  const report = {
    runId,
    title: scenario.title,
    baseUrl: scenario.url,
    status,
    logs: log,
    createdAt: new Date().toISOString(),
  };
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(directory, "report.html"),
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(scenario.title)} 결과</title><h1>${escapeHtml(scenario.title)}</h1><p>상태: ${escapeHtml(status)}</p><ul>${log.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    "utf8",
  );
  return directory;
};

// 렌더러가 만든 Markdown 리포트를 사용자가 고른 위치에 저장한다.
export const saveRunReport = async (
  window: BrowserWindow | null,
  markdown: string,
  fileName: string,
): Promise<string | null> => {
  const safeName =
    path.basename(fileName).replace(/[\\/:*?"<>|]/g, "_") || "checkly-report.md";
  const options = {
    title: "실행 리포트 저장",
    defaultPath: path.join(
      app.getPath("downloads"),
      safeName.endsWith(".md") ? safeName : `${safeName}.md`,
    ),
    filters: [{ name: "Markdown 리포트", extensions: ["md"] }],
  };
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, markdown, "utf8");
  return result.filePath;
};
