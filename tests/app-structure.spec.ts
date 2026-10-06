import { expect, test } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// main·preload 공용 파일에 기능 코드가 다시 쌓이지 않도록 도메인 구조를 검사한다.
// 기능은 src/app/ipc/<도메인>/ 의 index.ts(main)·bridge.ts(preload)에 추가한다.
const app = path.resolve("src/app");
const read = (file: string) => readFileSync(path.join(app, file), "utf8");
const domains = readdirSync(path.join(app, "ipc"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test("main.ts는 IPC를 직접 등록하지 않고 도메인 목록만 조립한다", () => {
  const main = read("main.ts");
  expect(main).not.toMatch(/\bipcMain\b/);
  for (const domain of domains) {
    expect(existsSync(path.join(app, "ipc", domain, "index.ts")), `ipc/${domain}/index.ts`).toBe(true);
    expect(main, `main.ts가 ./ipc/${domain} 를 조립해야 함`).toContain(`"./ipc/${domain}"`);
  }
  // 도메인 index가 아닌 내부 파일을 main.ts가 직접 import하면 다시 공용 파일이 커진다.
  expect(main).not.toMatch(/from "\.\/ipc\/[^"]+\/[^"]+"/);
});

test("preload.ts는 ipcRenderer를 직접 쓰지 않고 도메인 bridge만 조립한다", () => {
  const preload = read("preload.ts");
  expect(preload).not.toMatch(/\bipcRenderer\b/);
  for (const domain of domains) {
    if (!existsSync(path.join(app, "ipc", domain, "bridge.ts"))) continue;
    expect(preload, `preload.ts가 ./ipc/${domain}/bridge 를 조립해야 함`).toContain(`'./ipc/${domain}/bridge'`);
  }
});

test("bridge.ts는 preload에서 실행되므로 main 전용 모듈을 값으로 import하지 않는다", () => {
  const bridges = [
    "api-testing/bridge.ts",
    ...domains.map((domain) => `ipc/${domain}/bridge.ts`).filter((file) => existsSync(path.join(app, file))),
  ];
  for (const file of bridges) {
    const valueImports = [...read(file).matchAll(/^import (?!type )[^;\n]*from ['"]([^'"]+)['"]/gm)]
      .map((match) => match[1])
      .filter((specifier) => specifier !== "electron" && !specifier.endsWith("/subscribe"));
    expect(valueImports, file).toEqual([]);
  }
});
