import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Run after npm run build: npx tsx tests/form-viewport.desktop.ts
async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-form-viewport-"));
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Responsive form</title><style>body { background: white } @media(max-width: 500px) { body { background: rgb(1, 2, 3) } }</style><label>Name<input id="name"></label>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = { ...process.env, CHECKLY_SUPABASE_URL: "", CHECKLY_SUPABASE_ANON_KEY: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15_000);
    await page.getByRole("button", { name: "폼 자동 완성", exact: true }).click();
    await page.getByLabel("대상 사이트 주소").fill(url);
    await page.getByRole("button", { name: "이동", exact: true }).click();
    const guest = <T,>(script: string): Promise<T> => page.locator("webview.active").evaluate(
      (element, code) => (element as HTMLElement & { executeJavaScript: (code: string) => Promise<T> }).executeJavaScript(code), script,
    );
    await expect.poll(() => guest<string>("document.title")).toBe("Responsive form");
    await guest("document.querySelector('#name').value = 'kept input'");
    const guestId = await page.locator("webview.active").evaluate(element => (element as HTMLElement & { getWebContentsId: () => number }).getWebContentsId());
    const size = () => guest<number[]>("[innerWidth, innerHeight]");
    const viewport = page.getByLabel("미리보기 화면 크기");
    await viewport.selectOption("mobile");
    await expect.poll(size).toEqual([390, 844]);
    await expect.poll(() => guest<string>("getComputedStyle(document.body).backgroundColor")).toBe("rgb(1, 2, 3)");
    await page.getByRole("button", { name: "화면 확대", exact: true }).click();
    await expect.poll(size).toEqual([390, 844]);
    await page.getByRole("button", { name: "가로·세로 전환", exact: true }).click();
    await expect.poll(size).toEqual([844, 390]);
    await expect.poll(() => guest<string>("getComputedStyle(document.body).backgroundColor")).toBe("rgb(255, 255, 255)");
    await page.getByRole("button", { name: "가로·세로 전환", exact: true }).click();
    for (const [id, width, height] of [["mobile-small", 375, 667], ["mobile-large", 412, 915], ["tablet", 768, 1024]] as const) {
      await viewport.selectOption(id);
      await expect.poll(size).toEqual([width, height]);
    }
    await viewport.selectOption("desktop");
    await expect.poll(() => guest<string>("document.querySelector('#name').value")).toBe("kept input");
    expect(await page.locator("webview.active").evaluate(element => (element as HTMLElement & { getWebContentsId: () => number }).getWebContentsId())).toBe(guestId);
    await viewport.selectOption("mobile");
    await page.getByRole("button", { name: "가로·세로 전환", exact: true }).click();
    await expect.poll(async () => JSON.stringify((await page.evaluate(() => window.electronAPI.loadFormAutomationState())).values)).toContain('"checkly-form-browser-landscape":true');
    await page.reload();
    await page.getByRole("button", { name: "폼 자동 완성", exact: true }).click();
    await expect(page.getByLabel("미리보기 화면 크기")).toHaveValue("mobile");
    await expect.poll(size).toEqual([844, 390]);
    console.log("PASS: native guest viewport, responsive CSS, zoom, rotation, presets, input/session preservation, persisted settings");
  } finally {
    await app?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
