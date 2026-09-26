import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-desktop-"));
  const docsAuth = `Basic ${Buffer.from("docs-user:docs-test-password").toString("base64")}`;
  let leakedAuth = false;
  let lastApiAuth: string | undefined;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/openapi.json" && req.headers.authorization !== docsAuth) { res.statusCode = 401; res.end('{}'); return; }
    if (req.url !== "/openapi.json" && req.headers.authorization === docsAuth) leakedAuth = true;
    if (req.url !== "/openapi.json") lastApiAuth = req.headers.authorization;
    if (req.url === "/login") {
      res.setHeader("set-cookie", "SESSION=desktop-session; Path=/; HttpOnly");
      res.end(JSON.stringify({ accessToken: "login-secret-token", id: 7 }));
      return;
    }
    if (req.url === "/openapi.json") res.end(JSON.stringify({ openapi: "3.0.3", info: { title: "로컬 상품 API", version: "1.0" }, paths: { "/login": { post: { summary: "로그인", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["loginId"], properties: { loginId: { type: "string" } } } } } }, responses: { "200": { description: "성공", content: { "application/json": { schema: { type: "object", properties: { accessToken: { type: "string" }, id: { type: "integer" } } } } } } } } }, "/items/{id}": { get: { summary: "상품 상세 조회", description: "상품 번호로 이름과 가격을 확인합니다.", parameters: [{ name: "id", in: "path", required: true, description: "조회할 상품 번호", schema: { type: "integer" } }], responses: { "200": { description: "조회 성공", content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, price: { type: "integer" } } } } } } } } } } }));
    else res.end(JSON.stringify({ id: 7, name: "테스트 상품", price: 12000, accessToken: "hidden-secret", cookie: req.headers.cookie ?? "" }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // What the user's own AI would print in chat: prose around one fenced YAML block.
  const aiOutput = (itemApi: string) => "시나리오입니다.\n```yaml\n" + [
    "group: AI/인증\nname: AI 로그인\nserver: 기본 API\nsteps:\n  - name: 로그인\n    api: POST /login\n    body: { loginId: tester }\n    extract: [{ pointer: /accessToken, target: globals.accessToken, sensitive: true }]\n",
    `name: AI 상품 조회\nserver: 기본 API\nsteps:\n  - name: 상품 조회\n    api: '${itemApi}'\n    pathParams: { id: 7 }\n`,
    "suite: { name: AI 상점 흐름, group: AI, scenarios: [AI 로그인, AI 상품 조회] }\n",
  ].join("---\n") + "```\n";
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`], env });
    const page = await app.firstWindow();
    // Library-mode Playwright has no default timeout; fail instead of hanging.
    page.setDefaultTimeout(15_000);
    // CHECKLY_E2E_SHOTS=<dir> saves screenshots of key screens for visual review.
    const shot = async (name: string) => { if (process.env.CHECKLY_E2E_SHOTS) await page.screenshot({ path: path.join(process.env.CHECKLY_E2E_SHOTS, `${name}.png`) }); };
    page.on("dialog", dialog => {
      void (dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
    });
    await page.getByRole("button", { name: "API 테스트", exact: true }).click();
    await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
    await page.getByLabel("프로젝트 이름").fill("쇼핑몰 QA");
    await page.getByLabel("기본 API 기본 주소").fill(url);
    await page.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
    await page.getByLabel("OpenAPI URL").fill(`${url}/openapi.json`);
    await page.getByRole("button", { name: "URL 가져오기", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("명세 인증 실패: HTTP 401");
    await page.getByLabel("Swagger 인증 방식").selectOption("basic");
    await page.getByLabel("Swagger 아이디", { exact: true }).fill("docs-user");
    await page.getByLabel("Swagger 비밀번호", { exact: true }).fill("docs-test-password");
    const canRemember = await page.getByLabel("이 기기에 계정 기억", { exact: true }).isEnabled();
    if (canRemember) await page.getByLabel("이 기기에 계정 기억", { exact: true }).check();
    await page.getByRole("button", { name: "URL 가져오기", exact: true }).click();
    await expect(page.getByLabel("Swagger 비밀번호", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "태그 모두 접기", exact: true }).click();
    await expect(page.getByRole("button", { name: /GET.*items/ })).not.toBeVisible();
    await page.getByRole("button", { name: "태그 모두 펼치기", exact: true }).click();
    await page.getByRole("button", { name: /GET.*items/ }).click();
    await expect(page.getByText("상품 번호로 이름과 가격을 확인합니다.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Responses 응답 명세" })).toContainText("200");
    await shot("docs");
    await page.getByRole("button", { name: "Try it out", exact: true }).click();
    await page.getByLabel("path id", { exact: true }).fill("7");
    await page.getByRole("button", { name: "선택한 API 테스트 실행", exact: true }).click();
    await expect(page.getByRole("region", { name: "API 응답" })).toContainText("200");
    await expect(page.getByRole("region", { name: "API 응답" })).toContainText("테스트 상품");
    await expect(page.getByRole("region", { name: "API 응답" })).toContainText("hidden-secret");
    if (leakedAuth) throw new Error("Documentation credentials forwarded to API");
    await page.getByRole("button", { name: "Authorize", exact: true }).click();
    await page.getByLabel("새 API 인증 토큰", { exact: true }).fill("desktop-api-token");
    await page.getByRole("button", { name: "세션 변수로 등록 · 연결", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "API 요청 인증", exact: true })).toContainText("연결: globals.apiToken_");
    await expect(page.getByLabel("새 API 인증 토큰", { exact: true })).toHaveValue("");
    const authVariable = await page.getByLabel("API 인증 전역변수", { exact: true }).inputValue();
    await page.getByRole("button", { name: "인증 해제", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "API 요청 인증", exact: true })).toContainText("연결된 인증 없음");
    await page.getByLabel("API 인증 전역변수", { exact: true }).selectOption(authVariable);
    await page.getByRole("button", { name: "인증에 연결", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "API 요청 인증", exact: true })).toContainText(`연결: globals.${authVariable}`);
    await shot("api-auth");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "선택한 API 테스트 실행", exact: true }).click();
    await expect(page.getByRole("region", { name: "API 응답" })).toContainText("200");
    if (lastApiAuth !== "Bearer desktop-api-token") throw new Error("Selected token not applied");
    await page.getByRole("button", { name: "Authorize", exact: true }).click();
    await page.getByRole("button", { name: "인증 해제", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "API 요청 인증", exact: true })).toContainText("연결된 인증 없음");
    await page.keyboard.press("Escape");
    for (const file of await readdir(path.join(dir, "api-testing"))) {
      const data = await readFile(path.join(dir, "api-testing", file), "utf8");
      if (data.includes("docs-test-password") || data.includes(docsAuth) || data.includes("desktop-api-token")) throw new Error("Credentials persisted");
    }
    await page.getByRole("button", { name: "{ } 전역변수", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "{ } 전역변수", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "{ } 전역변수", exact: true })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "{ } 전역변수", exact: true })).toBeFocused();
    // Globals: the add form lives in a collapsed "변수 추가" section.
    const globals = page.getByRole("dialog", { name: "{ } 전역변수", exact: true });
    await page.getByRole("button", { name: "{ } 전역변수", exact: true }).click();
    await globals.getByText("변수 추가", { exact: true }).click();
    await page.getByLabel("전역변수 이름", { exact: true }).fill("sampleId");
    await page.getByLabel("전역변수 형식", { exact: true }).selectOption("json");
    await page.getByLabel("전역변수 값", { exact: true }).fill("7");
    await page.getByRole("button", { name: "전역변수 저장", exact: true }).click();
    await expect(globals.locator(".api-global-row").filter({ hasText: "sampleId" })).toBeVisible();
    await expect(globals.getByRole("region", { name: "세션 쿠키" })).toContainText("저장된 쿠키가 없습니다.");
    await page.keyboard.press("Escape");

    // AI authoring: copy the prompt for the user's own AI, check what it wrote, save scenarios and suite.
    await page.getByRole("tab", { name: "AI 작성 도우미", exact: true }).click();
    await expect(page.getByText("명세를 다시 가져오세요")).toHaveCount(0);
    await page.getByRole("button", { name: "가이드 보기", exact: true }).click();
    await expect(page.getByLabel("AI 가이드 내용", { exact: true })).toContainText("먼저 사용자에게 무엇을 테스트할지 물어보세요");
    await page.getByRole("button", { name: "가이드 닫기", exact: true }).click();
    await expect(page.getByLabel("AI 가이드 내용", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "AI 가이드 복사", exact: true }).click();
    await expect(page.getByRole("region", { name: "AI 시나리오 작성" })).toContainText("복사했습니다.");
    const prompt = await app.evaluate(({ clipboard }) => clipboard.readText());
    const resultFile = /결과를 파일 (.+?) 에 저장합니다/.exec(prompt)?.[1];
    if (!resultFile || !prompt.includes("api-catalog.json") || prompt.includes(url)) throw new Error("AI guide misses the result or schema file, or leaks the base URL");
    await page.getByRole("button", { name: "AI 결과 불러오기", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("아직 AI 결과가 없습니다");
    // Pasting what the AI printed in chat works too.
    await page.getByText("YAML 직접 붙여넣기·파일 가져오기", { exact: true }).click();
    await page.getByLabel("AI가 만든 YAML", { exact: true }).fill(aiOutput("GET /missing"));
    await page.getByRole("button", { name: "검사", exact: true }).click();
    const aiResult = page.getByRole("region", { name: "AI 작성 결과" });
    await expect(aiResult).toContainText("수정 필요");
    await expect(aiResult.getByRole("button", { name: "문제 복사", exact: true })).toBeVisible();
    // The fixed result comes from the file the AI writes.
    await writeFile(resultFile, aiOutput("GET /items/{id}"));
    await page.getByRole("button", { name: "AI 결과 불러오기", exact: true }).click();
    await expect(aiResult).toContainText("AI 로그인");
    await expect(aiResult).toContainText("AI 상품 조회");
    await expect(aiResult.getByText("바로 실행 가능")).toHaveCount(2);
    await expect(aiResult.getByRole("button", { name: "문제 복사", exact: true })).toHaveCount(0);
    await shot("ai-result");
    await page.getByRole("button", { name: "선택한 것 저장", exact: true }).click();
    await expect(page.getByRole("tab", { name: "시나리오", exact: true })).toHaveAttribute("aria-selected", "true");
    // The AI's group became a folder: AI › 인증.
    await page.locator(".api-sidebar-folder > summary").filter({ hasText: "인증" }).click();
    await expect(page.getByRole("button", { name: /AI 로그인/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI 상점 흐름/ })).toBeVisible();

    // Compose: login → item detail, linking the login response id into the path.
    await page.getByRole("tab", { name: "시나리오", exact: true }).click();
    await page.getByRole("button", { name: "+ 새 시나리오", exact: true }).click();
    await page.getByRole("button", { name: "시나리오에 API 추가", exact: true }).nth(0).click();
    await page.getByRole("button", { name: "시나리오에 API 추가", exact: true }).nth(1).click();
    // Reorder by dragging the whole row, then back with the keyboard.
    const selectedRows = page.locator(".api-selected-row");
    await expect(selectedRows.nth(0)).toContainText("/login");
    await page.getByRole("button", { name: /^2단계 .* 순서 변경$/ }).hover();
    await page.mouse.down();
    const firstRow = await selectedRows.nth(0).boundingBox();
    if (!firstRow) throw new Error("Selected API row is not visible");
    await page.mouse.move(firstRow.x + firstRow.width / 2, firstRow.y + 4, { steps: 12 });
    await expect(page.locator(".api-sortable-item.is-dragging")).toHaveCount(1);
    // Holding still before the drop must not lose it.
    await page.waitForTimeout(300);
    await shot("dragging");
    const previewTop = await selectedRows.filter({ hasText: "/items/{id}" }).evaluate(row => row.getBoundingClientRect().top);
    await page.mouse.up();
    // The dropped row stays where the preview showed it instead of jumping back first.
    const droppedTop = await selectedRows.filter({ hasText: "/items/{id}" }).evaluate(row => new Promise<number>(resolve => requestAnimationFrame(() => resolve(row.getBoundingClientRect().top))));
    if (Math.abs(droppedTop - previewTop) > 2) throw new Error(`Dropped row jumped from ${previewTop} to ${droppedTop}`);
    await expect(selectedRows.nth(0)).toContainText("/items/{id}");
    await shot("reordered");
    await page.getByRole("button", { name: /^1단계 .* 순서 변경$/ }).press("ArrowDown");
    await expect(selectedRows.nth(0)).toContainText("/login");
    await expect(page.getByRole("button", { name: /^2단계 .* 순서 변경$/ })).toBeFocused();
    await page.getByRole("button", { name: "선택 및 순서 설정 완료", exact: true }).click();
    await page.locator('details[aria-label="편집 단계 1"] > summary').click();
    await page.locator('details[aria-label="편집 단계 2"] > summary').click();
    await page.getByLabel("시나리오 이름", { exact: true }).fill("로그인 후 상품 조회");
    await page.getByRole("button", { name: "1단계 loginId 키 값 연결", exact: true }).click();
    await page.getByLabel("1단계 loginId 직접 입력값", { exact: true }).fill("tester");
    await page.getByRole("button", { name: "입력값 적용", exact: true }).click();
    await page.getByRole("button", { name: "/accessToken 키 선택", exact: true }).first().click();
    await page.getByRole("button", { name: /^전역변수로 저장/ }).click();
    await page.getByLabel("응답 전역변수 이름", { exact: true }).fill("accessToken");
    await page.getByRole("button", { name: "저장 설정 적용", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "값 연결", exact: true }).click();
    await page.getByRole("button", { name: /^이전 단계 값 선택/ }).click();
    await page.getByRole("button", { name: "/id integer 값 선택", exact: true }).click();
    await page.getByRole("button", { name: "이 값으로 연결", exact: true }).click();
    await shot("compose");
    await page.getByRole("button", { name: "시나리오 검사·저장", exact: true }).click();
    await expect(page.getByText("시나리오를 저장했습니다. 이 화면에서 계속 수정할 수 있습니다.", { exact: true })).toBeVisible();
    await expect(page.getByText("시나리오 수정 · 로그인 후 상품 조회", { exact: true })).toBeVisible();

    // Run the saved scenario.
    await page.getByRole("button", { name: "← 시나리오 목록", exact: true }).click();
    await page.getByRole("button", { name: /로그인 후 상품 조회/ }).click();
    await page.getByRole("button", { name: "실행", exact: true }).click();
    const result = page.getByRole("region", { name: "시나리오 실행 결과" });
    await expect(result).toContainText("통과");
    await shot("run-result");
    // The session cookie from login reaches the next request.
    await expect(result).toContainText("SESSION=desktop-session");
    // Raw values stay in the DOM; the default-on toggle hides only sensitive ones.
    const masking = async (text: string) => result.locator("span", { hasText: text }).last().evaluate(node => getComputedStyle(node).webkitTextSecurity);
    await expect(page.getByRole("switch", { name: "민감값 숨기기" })).toHaveAttribute("aria-checked", "true");
    if (await masking("login-secret-token") !== "disc") throw new Error("Access token is not masked");
    if (await masking("테스트 상품") === "disc") throw new Error("Ordinary response value is masked");

    // The extracted token and the session cookie are shared by the project.
    await page.getByRole("button", { name: "{ } 전역변수", exact: true }).click();
    await shot("globals");
    const tokenRow = globals.locator(".api-global-row").filter({ hasText: "accessToken" });
    await expect(tokenRow).toBeVisible();
    if (await tokenRow.locator(".api-global-value").evaluate(node => getComputedStyle(node).webkitTextSecurity) !== "disc") throw new Error("Token global is not masked");
    await expect(globals.getByRole("region", { name: "세션 쿠키" })).toContainText("SESSION");
    await expect(globals.getByRole("region", { name: "세션 쿠키" })).not.toContainText("desktop-session");
    await page.keyboard.press("Escape");
    // A copy opens in place and is deleted from its detail view.
    await page.getByRole("button", { name: "복제", exact: true }).click();
    await expect(page.getByRole("heading", { name: "로그인 후 상품 조회 사본", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "시나리오 삭제", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 삭제 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: /로그인 후 상품 조회 사본/ })).toHaveCount(0);
    // Suites keep their run action in the header, like scenarios.
    await page.getByRole("button", { name: /AI 상점 흐름/ }).click();
    await expect(page.getByRole("button", { name: "실행", exact: true })).toBeEnabled();
    await shot("suite");
    // Suite order uses the same sortable list; an unsaved order blocks running.
    await page.getByRole("button", { name: /^1번째 AI 로그인 순서 변경$/ }).press("ArrowDown");
    await expect(page.locator(".api-suite-order").nth(0)).toContainText("AI 상품 조회");
    await expect(page.getByRole("button", { name: "실행", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: /^2번째 AI 로그인 순서 변경$/ }).press("ArrowUp");
    await expect(page.getByRole("button", { name: "실행", exact: true })).toBeEnabled();
    // Scenarios are deleted from their detail view.
    await page.getByRole("button", { name: "AI 상품 조회", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 삭제", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 삭제 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: "AI 상품 조회", exact: true })).toHaveCount(0);
    await shot("final");
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`], env });
    const restored = await app.firstWindow();
    restored.setDefaultTimeout(15_000);
    await restored.getByRole("button", { name: "API 테스트", exact: true }).click();
    await expect(restored.getByLabel("API 프로젝트")).toContainText("쇼핑몰 QA");
    await expect(restored.getByLabel("OpenAPI URL", { exact: true })).toHaveValue(`${url}/openapi.json`);
    if (canRemember) {
      await expect(restored.getByLabel("Swagger 비밀번호", { exact: true })).toHaveValue("");
      await restored.getByRole("button", { name: "명세 새로고침", exact: true }).click();
      await expect(restored.getByText(/최근 동기화 성공/)).toBeVisible();
      await restored.getByRole("button", { name: "저장된 계정 삭제", exact: true }).click();
      await expect(restored.getByRole("button", { name: "저장된 계정 삭제", exact: true })).not.toBeVisible();
    }
    await expect(restored.getByRole("button", { name: /GET.*items/ })).toBeVisible();
    await restored.getByRole("tab", { name: "시나리오", exact: true }).click();
    await expect(restored.getByRole("button", { name: /로그인 후 상품 조회/ })).toBeVisible();
    await expect(restored.getByRole("button", { name: "AI 상품 조회", exact: true })).toHaveCount(0);
    await restored.getByRole("button", { name: "{ } 전역변수", exact: true }).click();
    await expect(restored.getByText("저장된 변수가 없습니다.", { exact: true })).toBeVisible();
  } finally {
    try {
      const electronProcess = app?.process();
      if (electronProcess && electronProcess.exitCode === null) {
        // SIGTERM alone can be refused by a beforeunload prompt (unsaved editor), leaving a window open.
        electronProcess.kill();
        await Promise.race([new Promise(resolve => electronProcess.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3_000))]);
        if (electronProcess.exitCode === null && electronProcess.signalCode === null) electronProcess.kill("SIGKILL");
      }
    } catch (error) { console.error(`Electron cleanup failed: ${(error as Error).message}`); }
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
}
void main()
  .then(() => console.log("desktop e2e passed"))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => process.exit());
