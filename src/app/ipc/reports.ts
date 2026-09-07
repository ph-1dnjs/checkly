import { app } from "electron";
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
