import type { MarkerPositionStore } from "./scenario";

type UploadPath = { target: string; value: string };
const uploads = /`([^`]+)`에\s*`([^`]*)`\s*파일 업로드/g;

/** 업로드 파일 경로는 PC별로 보관하고 공유 문서에는 빈 값만 남긴다. */
export const separateUploadPaths = (markdown: string, positions: string) => {
  const paths: UploadPath[] = [];
  const sharedMarkdown = markdown.replace(uploads, (_match, target: string, value: string) => {
    paths.push({ target, value });
    return `\`${target}\`에 \`\` 파일 업로드`;
  });
  const store = JSON.parse(positions) as MarkerPositionStore;
  const sharedPositions = Object.fromEntries(Object.entries(store).map(([key, items]) => [key,
    items.map(item => item.action === "fileUpload" ? { ...item, value: "" } : item),
  ]));
  return { markdown: sharedMarkdown, positions: JSON.stringify(sharedPositions), paths };
};

export const restoreUploadPaths = <T extends { markdown: string; positions: string }>(record: T, paths: UploadPath[]): T => {
  let index = 0;
  const markdown = record.markdown.replace(uploads, (_match, target: string) => {
    const path = paths[index++];
    return `\`${target}\`에 \`${path?.target === target ? path.value : ""}\` 파일 업로드`;
  });
  const store = JSON.parse(record.positions) as MarkerPositionStore;
  const positions = Object.fromEntries(Object.entries(store).map(([key, items]) => [key,
    items.map(item => item.action === "fileUpload" ? { ...item, value: paths.find(path => path.target === item.target)?.value ?? "" } : item),
  ]));
  return { ...record, markdown, positions: JSON.stringify(positions) };
};
