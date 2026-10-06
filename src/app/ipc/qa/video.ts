import { app } from "electron";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { QaScenario } from "./qaTypes";

const executeFile = promisify(execFile);

export const runVideoDirectory = (): string =>
  path.join(app.getPath("userData"), "videos", "runs");
export const runVideoFileName = (scenario: QaScenario): string => {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  ]
    .map((value, index) =>
      index === 0 ? String(value) : String(value).padStart(2, "0"),
    )
    .join("");
  const title =
    scenario.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "시나리오";
  return `${title}_실행${timestamp}.webm`;
};
const fullRunVideoFileName = (): string =>
  `전체_시나리오_실행${Date.now()}.webm`;
// Playwright JS 코드는 asar 안에서도 실행되지만, 번들된 ffmpeg 실행 파일은 spawn 대상이라
// asar 밖(app.asar.unpacked)의 실제 경로를 가리켜야 한다.
const ffmpegExecutablePath = ffmpegPath?.replace(
  "app.asar",
  "app.asar.unpacked",
);

export const mergeRunVideos = async (
  filePaths: string[],
): Promise<string | null> => {
  const videos = [...new Set(filePaths)];
  if (!videos.length) return null;
  if (!ffmpegExecutablePath)
    throw new Error("영상 병합 도구를 찾을 수 없습니다.");
  if (
    videos.some((filePath) => path.dirname(filePath) !== runVideoDirectory())
  ) {
    throw new Error("허용되지 않은 영상 경로입니다.");
  }
  const manifestPath = path.join(
    runVideoDirectory(),
    `concat-${Date.now()}.txt`,
  );
  const destination = path.join(runVideoDirectory(), fullRunVideoFileName());
  await mkdir(runVideoDirectory(), { recursive: true });
  await writeFile(
    manifestPath,
    videos
      .map((filePath) => `file '${filePath.replace(/'/g, "'\\\\''")}'`)
      .join("\n"),
    "utf8",
  );
  try {
    await executeFile(ffmpegExecutablePath, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      manifestPath,
      "-c",
      "copy",
      destination,
    ]);
    return destination;
  } finally {
    await unlink(manifestPath).catch(() => undefined);
  }
};

export const downloadRunVideo = async (filePath: string): Promise<string> => {
  if (path.dirname(filePath) !== runVideoDirectory())
    throw new Error("허용되지 않은 영상 경로입니다.");
  await readFile(filePath);
  const destination = path.join(
    app.getPath("downloads"),
    path.basename(filePath),
  );
  await copyFile(filePath, destination);
  return destination;
};
