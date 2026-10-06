import path from "node:path";

// 빌드 결과(dist-electron) 루트 기준 경로. 도메인 폴더 안에서 __dirname을 쓰면 폴더 깊이에 따라
// 경로가 달라지므로, 루트에 있는 이 파일의 __dirname으로만 계산한다.
export const electronOutPath = (...segments: string[]): string =>
  path.join(__dirname, ...segments);
