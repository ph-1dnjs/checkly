// 개발 실행 시 macOS 메뉴 막대·Dock·Cmd+Tab에 "Electron" 대신 앱 이름이 보이도록
// node_modules 안의 Electron.app Info.plist 이름을 바꾼다. 패키징된 앱은
// electron-builder의 productName을 쓰므로 영향이 없다.
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") process.exit(0);

const productName = require("../package.json").build.productName;
const plist = path.join(
  path.dirname(require.resolve("electron/package.json")),
  "dist/Electron.app/Contents/Info.plist",
);
if (!existsSync(plist)) process.exit(0);

const buddy = (command) =>
  execFileSync("/usr/libexec/PlistBuddy", ["-c", command, plist], {
    encoding: "utf8",
  }).trim();

try {
  if (buddy("Print :CFBundleName") === productName) process.exit(0);
  buddy(`Set :CFBundleName ${productName}`);
  try {
    buddy(`Set :CFBundleDisplayName ${productName}`);
  } catch {
    buddy(`Add :CFBundleDisplayName string ${productName}`);
  }
  console.log(`[rename-dev-electron] Electron.app 표시 이름을 ${productName}(으)로 변경했습니다.`);
} catch (error) {
  console.warn("[rename-dev-electron] 이름 변경을 건너뜁니다:", error.message);
}
