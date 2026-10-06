import { app, dialog } from "electron";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

let activeScenarioFilePath: string | null = null;

const scenarioStorePath = (): string =>
  path.join(app.getPath("userData"), "scenarios.md");
const markerPositionStorePath = (): string =>
  path.join(app.getPath("userData"), "marker-positions.json");

export const loadScenarioMarkdown = async (): Promise<string | null> => {
  try {
    return await readFile(scenarioStorePath(), "utf8");
  } catch {
    return null;
  }
};
export const saveScenarioMarkdown = async (markdown: string): Promise<void> => {
  await writeFile(scenarioStorePath(), markdown, "utf8");
};
const scenarioFileFilter = [
  { name: "Markdown 시나리오", extensions: ["md", "markdown"] },
];
export const importScenarioFile = async (): Promise<{
  markdown: string;
  filePath: string;
} | null> => {
  const result = await dialog.showOpenDialog({
    title: "시나리오 불러오기",
    properties: ["openFile"],
    filters: scenarioFileFilter,
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  activeScenarioFilePath = filePath;
  return { markdown: await readFile(filePath, "utf8"), filePath };
};
export const saveImportedScenarioFile = async (
  markdown: string,
): Promise<string | null> => {
  if (!activeScenarioFilePath) return null;
  await writeFile(activeScenarioFilePath, markdown, "utf8");
  return activeScenarioFilePath;
};
export const exportScenarioFile = async (
  markdown: string,
): Promise<string | null> => {
  const result = await dialog.showSaveDialog({
    title: "시나리오 저장하기",
    defaultPath: "scenario.md",
    filters: scenarioFileFilter,
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, markdown, "utf8");
  activeScenarioFilePath = result.filePath;
  return result.filePath;
};
export const loadMarkerPositions = async (): Promise<string | null> => {
  try {
    return await readFile(markerPositionStorePath(), "utf8");
  } catch {
    return null;
  }
};
export const saveMarkerPositions = async (positions: string): Promise<void> => {
  await writeFile(markerPositionStorePath(), positions, "utf8");
};

export type ScenarioFolderListing = {
  folderPath: string | null;
  files: Array<{ name: string; path: string; updatedAt: string }>;
};
const scenarioFolderStorePath = (): string =>
  path.join(app.getPath("userData"), "scenario-folder.json");
const readScenarioFolderPath = async (): Promise<string | null> => {
  try {
    const raw = JSON.parse(
      await readFile(scenarioFolderStorePath(), "utf8"),
    ) as { folderPath?: string | null };
    return raw.folderPath ?? null;
  } catch {
    return null;
  }
};
const writeScenarioFolderPath = async (folderPath: string): Promise<void> => {
  await writeFile(
    scenarioFolderStorePath(),
    JSON.stringify({ folderPath }),
    "utf8",
  );
};
export const listScenarioFolder = async (): Promise<ScenarioFolderListing> => {
  const folderPath = await readScenarioFolderPath();
  if (!folderPath) return { folderPath: null, files: [] };
  try {
    const entries = await readdir(folderPath);
    const mdEntries = entries.filter((name) => /\.(md|markdown)$/i.test(name));
    const files = await Promise.all(
      mdEntries.map(async (name) => {
        const filePath = path.join(folderPath, name);
        const info = await stat(filePath);
        return { name, path: filePath, updatedAt: info.mtime.toISOString() };
      }),
    );
    files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { folderPath, files };
  } catch {
    return { folderPath: null, files: [] };
  }
};
export const chooseScenarioFolder =
  async (): Promise<ScenarioFolderListing> => {
    const result = await dialog.showOpenDialog({
      title: "시나리오 폴더 선택",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return listScenarioFolder();
    await writeScenarioFolderPath(result.filePaths[0]);
    return listScenarioFolder();
  };
export const readScenarioFile = async (
  filePath: string,
): Promise<string | null> => {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
};
export const selectUploadFile = async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    title: "업로드할 파일 선택",
    properties: ["openFile"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
};
