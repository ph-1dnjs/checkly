import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ApiTestingBridge } from "../../src/app/api-testing/shared/workspace";

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-desktop-"));
  const docsAuth = `Basic ${Buffer.from("docs-user:docs-test-password").toString("base64")}`;
  let leakedAuth = false;
  let lastApiAuth: string | undefined;
  const loginInputs: string[] = [];
  const decimalInputs: unknown[] = [];
  // Version 2 of the spec renames /items/{id}, as a backend refactor might.
  let itemsPath = "/items/{id}";
  let itemsTitle = "상품 상세 조회";
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/openapi.json" && req.headers.authorization !== docsAuth) { res.statusCode = 401; res.end('{}'); return; }
    if (req.url !== "/openapi.json" && req.headers.authorization === docsAuth) leakedAuth = true;
    if (req.url !== "/openapi.json") lastApiAuth = req.headers.authorization;
    if (req.url === "/login") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      loginInputs.push(input.loginId);
      if (Object.hasOwn(input, "amount")) decimalInputs.push(input.amount);
      res.setHeader("set-cookie", "SESSION=desktop-session; Path=/; HttpOnly");
      res.end(JSON.stringify({ accessToken: "login-secret-token", id: 7 }));
      return;
    }
    if (req.url === "/openapi.json") res.end(JSON.stringify({ openapi: "3.0.3", info: { title: "로컬 상품 API", version: "1.0" }, paths: { "/login": { post: { summary: "로그인", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["loginId"], properties: { loginId: { type: "string" } } } } } }, responses: { "200": { description: "성공", content: { "application/json": { schema: { type: "object", properties: { accessToken: { type: "string" }, id: { type: "integer" } } } } } } } } }, [itemsPath]: { get: { summary: itemsTitle, description: "상품 번호로 이름과 가격을 확인합니다.", parameters: [{ name: "id", in: "path", required: true, description: "조회할 상품 번호", schema: { type: "integer" } }], responses: { "200": { description: "조회 성공", content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, price: { type: "integer" } } } } } } } } } } }));
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
  // These flows are the local (no sign-in) mode: an empty value keeps .env's team server switched off.
  const env = { ...process.env, CHECKLY_SUPABASE_URL: "", CHECKLY_SUPABASE_ANON_KEY: "" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`], env });
    const page = await app.firstWindow();
    // Library-mode Playwright has no default timeout; fail instead of hanging.
    page.setDefaultTimeout(15_000);
    // CHECKLY_E2E_SHOTS=<dir> saves screenshots of key screens for visual review.
    // Drags a sortable row by its handle. A short first move lets the browser start the drag
    // (dragstart) before the long move, which otherwise sometimes races past it.
    const startDrag = async (handle: ReturnType<typeof page.locator>, target: ReturnType<typeof page.locator>) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const from = await handle.boundingBox();
        if (!from) throw new Error("Drag handle is not visible");
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 6, { steps: 3 });
        const started = await page.locator(".api-sortable-item.is-dragging").waitFor({ timeout: 1_000 }).then(() => true, () => false);
        if (started) {
          const box = await target.boundingBox();
          if (!box) throw new Error("Drop target is not visible");
          await page.mouse.move(box.x + box.width / 2, box.y + 4, { steps: 12 });
          return;
        }
        await page.mouse.up();
      }
      throw new Error("Drag did not start");
    };
    const shot = async (name: string) => { if (process.env.CHECKLY_E2E_SHOTS) await page.screenshot({ path: path.join(process.env.CHECKLY_E2E_SHOTS, `${name}.png`) }); };
    page.on("dialog", dialog => {
      void (dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
    });
    await page.getByRole("button", { name: "API 테스트", exact: true }).click();
    // First run offers both making a project and importing a shared one.
    await expect(page.getByRole("button", { name: "공유받은 파일 가져오기", exact: true })).toBeVisible();
    // Both sit centered under the message, like the other empty states.
    const centerOf = (name: string) => page.getByRole("button", { name, exact: true }).evaluate(element => { const box = element.getBoundingClientRect(); return box.left + box.width / 2; });
    const pageCenter = await page.locator(".api-empty").first().evaluate(element => { const box = element.getBoundingClientRect(); return box.left + box.width / 2; });
    if (Math.abs((await centerOf("프로젝트 만들기") + await centerOf("공유받은 파일 가져오기")) / 2 - pageCenter) > 40) throw new Error("First-run buttons are not centered");
    await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
    await page.getByLabel("프로젝트 이름").fill("쇼핑몰 QA");
    await page.getByLabel("기본 API 기본 주소").fill(url);
    await page.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
    // A new project opens on API 문서, where its spec is imported.
    await expect(page.getByRole("tab", { name: /^API 문서/ })).toHaveAttribute("aria-selected", "true");
    // With one server the header lists no servers (step tags only appear with two or more).
    await expect(page.getByLabel("프로젝트 서버", { exact: true })).toHaveCount(0);
    // No spec yet: the import form is open by itself.
    const specSource = page.getByRole("region", { name: "API 명세 가져오기" });
    const importButton = specSource.getByRole("button", { name: "이 URL로 가져오기", exact: true });
    await page.getByLabel("OpenAPI URL").fill(`${url}/openapi.json`);
    await importButton.click();
    // The failure shows inside the spec panel, next to the account fields.
    await expect(page.getByRole("region", { name: "API 명세 가져오기" }).getByRole("alert")).toContainText("명세 인증 실패: HTTP 401");
    await page.getByLabel("Swagger 인증 방식").selectOption("basic");
    await page.getByLabel("Swagger 아이디", { exact: true }).fill("docs-user");
    await page.getByLabel("Swagger 비밀번호", { exact: true }).fill("docs-test-password");
    const canRemember = await page.getByLabel("이 기기에 계정 기억", { exact: true }).isEnabled();
    if (canRemember) await page.getByLabel("이 기기에 계정 기억", { exact: true }).check();
    await importButton.click();
    // Imported: the form folds into one summary line.
    await expect(specSource).toContainText("최근 동기화 성공");
    await expect(page.getByLabel("OpenAPI URL")).toHaveCount(0);
    // Tags start folded (open operations slow Swagger typing); searching opens the matching tags.
    await expect(page.getByRole("button", { name: /GET.*items/ })).not.toBeVisible();
    await page.getByLabel("API 문서 검색", { exact: true }).fill("items");
    await expect(page.getByRole("button", { name: /GET.*items/ })).toBeVisible();
    await page.getByLabel("API 문서 검색", { exact: true }).fill("");
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
    // With no string globals yet, the panel starts on entering a new token.
    await page.getByLabel("새 API 인증 토큰", { exact: true }).fill("desktop-api-token");
    await page.getByRole("button", { name: "저장 후 연결", exact: true }).click();
    const authDialog = page.getByRole("dialog", { name: "API 요청 인증", exact: true });
    await expect(authDialog.getByRole("status")).toContainText("연결됨 · docsToken");
    await expect(page.getByLabel("새 API 인증 토큰", { exact: true })).toHaveCount(0);
    const authVariable = await page.getByLabel("API 인증 전역변수", { exact: true }).inputValue();
    await authDialog.getByRole("button", { name: "연결 해제", exact: true }).click();
    await expect(authDialog.getByRole("status")).toContainText("연결된 토큰 없음");
    await expect(authDialog.getByRole("button", { name: "연결 해제", exact: true })).toHaveCount(0);
    await page.getByLabel("API 인증 전역변수", { exact: true }).selectOption(authVariable);
    await authDialog.getByRole("button", { name: "연결", exact: true }).click();
    await expect(authDialog.getByRole("status")).toContainText(`연결됨 · ${authVariable}`);
    await shot("api-auth");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "선택한 API 테스트 실행", exact: true }).click();
    await expect(page.getByRole("region", { name: "API 응답" })).toContainText("200");
    await expect.poll(() => lastApiAuth).toBe("Bearer desktop-api-token");
    await page.getByRole("button", { name: "Authorize", exact: true }).click();
    await page.getByRole("button", { name: "연결 해제", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "API 요청 인증", exact: true }).getByRole("status")).toContainText("연결된 토큰 없음");
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
    // Globals: "+ 변수 추가" opens the form in place.
    const globals = page.getByRole("dialog", { name: "{ } 전역변수", exact: true });
    await page.getByRole("button", { name: "{ } 전역변수", exact: true }).click();
    await globals.getByRole("button", { name: "+ 변수 추가", exact: true }).click();
    // A new variable starts at its name (the focus waits a frame, and must not move once the user is typing).
    await expect(page.getByLabel("전역변수 이름", { exact: true })).toBeFocused();
    await page.getByLabel("전역변수 이름", { exact: true }).fill("sampleId");
    await page.getByLabel("전역변수 형식", { exact: true }).selectOption("json");
    await page.getByLabel("전역변수 값", { exact: true }).fill("7");
    await page.getByRole("button", { name: "전역변수 저장", exact: true }).click();
    // A refused save says why in the failure, instead of only "row not found".
    await expect(globals.locator(".api-global-row").filter({ hasText: "sampleId" })).toBeVisible()
      .catch(async (error: Error) => { throw new Error(`${error.message}\n전역변수 창: ${await globals.innerText().catch(() => "(닫힘)")}\n입력값: ${JSON.stringify(await globals.locator("input, select").evaluateAll(fields => fields.map(field => [field.getAttribute("aria-label"), (field as HTMLInputElement).value])).catch(() => []))}`); });
    await expect(globals.getByRole("region", { name: "세션 쿠키" })).toContainText("세션 쿠키 0개");
    await expect(globals.getByRole("button", { name: "쿠키 비우기", exact: true })).toBeDisabled();
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
    await page.getByText("또는 YAML 직접 붙여넣기·파일 가져오기", { exact: true }).click();
    await page.getByLabel("AI가 만든 YAML", { exact: true }).fill(aiOutput("GET /missing"));
    await page.getByRole("button", { name: "검사", exact: true }).click();
    const aiResult = page.getByRole("region", { name: "AI 작성 결과" });
    await expect(aiResult).toContainText("수정 필요");
    await expect(aiResult.getByRole("button", { name: "문제 복사", exact: true })).toBeVisible();
    // What goes back to the AI: the scenario as it wrote it, the problem, and where valid APIs are listed.
    await aiResult.getByRole("button", { name: "문제 복사", exact: true }).click();
    // The copy is asynchronous: wait until the clipboard holds the report instead of the guide.
    await expect.poll(() => app!.evaluate(({ clipboard }) => clipboard.readText())).toContain("Checkly 검사에서 아래 문제가 나왔습니다");
    const problems = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (!problems.includes("### 2번째 시나리오 · AI 상품 조회") || !problems.includes("GET /missing는 명세에 없는 API입니다") || !problems.includes("api-catalog.json") || /scenario-[0-9a-f]{8}/.test(problems)) throw new Error(`Unexpected problem report:\n${problems}`);
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
    // The first saved scenario opens, so its folder (the AI's group AI › 인증) is expanded.
    await expect(page.getByRole("heading", { name: "AI 로그인", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI 로그인/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI 상점 흐름/ })).toBeVisible();
    // A later result with the same name is a new version: it updates the saved scenario by default.
    // Not saving it makes the suite fall back to the saved one, so the suite still saves.
    await writeFile(resultFile, "name: AI 로그인\nserver: 기본 API\nsteps:\n  - { name: 로그인, api: POST /login, body: { loginId: tester } }\n---\nsuite: { name: AI 재사용 흐름, scenarios: [AI 로그인, AI 상품 조회] }\n");
    await page.getByRole("tab", { name: "AI 작성 도우미", exact: true }).click();
    await page.getByRole("button", { name: "AI 결과 불러오기", exact: true }).click();
    await expect(aiResult.getByLabel("AI 로그인 저장", { exact: true })).toBeChecked();
    await expect(aiResult.getByLabel("AI 로그인 저장 방식", { exact: true })).toHaveValue("update");
    await expect(aiResult.locator(".api-ai-author-suite li")).toHaveText(["AI 로그인 · 기존 시나리오 업데이트", "AI 상품 조회 · 기존 시나리오"]);
    await aiResult.getByLabel("AI 로그인 저장", { exact: true }).uncheck();
    await expect(aiResult.locator(".api-ai-author-suite li")).toHaveText(["AI 로그인 · 기존 시나리오 사용", "AI 상품 조회 · 기존 시나리오"]);
    await aiResult.getByRole("button", { name: "선택한 것 저장", exact: true }).click();
    await page.getByRole("button", { name: /AI 재사용 흐름/ }).click();
    await expect(page.getByRole("region", { name: "스위트 구성" })).toContainText("AI 로그인");
    await expect(page.getByRole("region", { name: "스위트 구성" })).toContainText("AI 상품 조회");

    // Compose: login → item detail, linking the login response id into the path.
    await page.getByRole("tab", { name: "시나리오", exact: true }).click();
    await page.getByRole("button", { name: "+ 새 시나리오", exact: true }).click();
    // The composer toolbar replaces the locked header: tabs hide, environment and values stay.
    await expect(page.getByRole("tab", { name: "시나리오", exact: true })).toBeHidden();
    await expect(page.getByRole("group", { name: "시나리오 전체 호출 환경" })).toBeVisible();
    await expect(page.getByRole("button", { name: "{ } 전역변수", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "시나리오에 API 추가", exact: true }).nth(0).click();
    await page.getByRole("button", { name: "시나리오에 API 추가", exact: true }).nth(1).click();
    // Step 1 docs are for reading and adding: no Try it out that would silently rewrite step values.
    await page.locator(".api-selected-content").first().click();
    await expect(page.locator(".api-swagger-renderer .opblock.is-open")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Try it out", exact: true })).toHaveCount(0);
    // Reorder by dragging the whole row, then back with the keyboard.
    const selectedRows = page.locator(".api-selected-row");
    await expect(selectedRows.nth(0)).toContainText("/login");
    await startDrag(page.getByRole("button", { name: /^2단계 .* 순서 변경$/ }), selectedRows.nth(0));
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
    // The description is prose: the same font as the name, not the monospace of JSON fields.
    const fontOf = (label: string) => page.getByLabel(label, { exact: true }).evaluate(element => getComputedStyle(element).fontFamily);
    if (await fontOf("시나리오 설명") !== await fontOf("시나리오 이름")) throw new Error("Description is not in the UI font");
    // loginId is typed while the scenario runs (runtime input), not stored in the scenario.
    await page.getByRole("button", { name: "1단계 loginId 키 값 연결", exact: true }).click();
    await page.getByRole("button", { name: /^실행 중 입력으로 받기/ }).click();
    await page.getByRole("button", { name: "완료", exact: true }).click();
    // The body shows what will be asked (not {{vars.…}}); the badge opens the input settings.
    const inputBadge = page.getByRole("button", { name: "1단계 loginId 실행 중 입력 설정", exact: true });
    await expect(inputBadge).toHaveText("실행 중 입력 · loginId 입력");
    await expect(page.locator('details[aria-label="편집 단계 1"]')).not.toContainText("{{vars.");
    await inputBadge.click();
    await expect(page.getByRole("dialog", { name: "loginId 실행 중 입력 설정", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "완료", exact: true }).click();
    // The settings summary labels each request part instead of showing "body" as a JSON key.
    const firstSummaryArea = page.locator(".api-summary-request-area").first();
    await expect(firstSummaryArea.locator(".api-summary-area-label")).toHaveText("본문");
    await expect(firstSummaryArea).toContainText("loginId");
    await expect(firstSummaryArea).not.toContainText('"body"');
    await page.getByRole("button", { name: "/accessToken 키 선택", exact: true }).first().click();
    await page.getByRole("button", { name: /^전역변수로 저장/ }).click();
    await page.getByLabel("응답 전역변수 이름", { exact: true }).fill("accessToken");
    await page.getByRole("button", { name: "저장 설정 적용", exact: true }).click();
    await page.keyboard.press("Escape");
    // Verifying the same field again edits it instead of adding a duplicate.
    await page.getByRole("button", { name: "/accessToken 키 선택", exact: true }).first().click();
    await page.getByRole("button", { name: /^이 값 검증/ }).click();
    await page.getByRole("button", { name: "검증 추가", exact: true }).click();
    await page.getByRole("button", { name: "/accessToken 키 선택", exact: true }).first().click();
    await page.getByRole("button", { name: /^이 값 검증/ }).click();
    await expect(page.getByRole("button", { name: "검증 수정", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "+ HTTP 상태 검증", exact: true }).first().click();
    // A new status check has no preset code; its value field opens focused.
    await expect(page.getByPlaceholder("예: 201 또는 404")).toBeFocused();
    await page.getByPlaceholder("예: 201 또는 404").fill("200");
    await expect(page.locator('details[aria-label="편집 단계 1"] > summary')).toContainText("검증 2");
    await page.getByRole("button", { name: "값 연결", exact: true }).click();
    await page.getByRole("button", { name: /^이전 단계 값 선택/ }).click();
    await page.getByRole("button", { name: "/id integer 값 선택", exact: true }).click();
    await page.getByRole("button", { name: "이 값으로 연결", exact: true }).click();
    // A check can compare with an earlier step's value: step 2's /id must equal step 1's response id.
    const secondStep = page.locator('details[aria-label="편집 단계 2"]');
    await secondStep.getByRole("button", { name: "/id 키 선택", exact: true }).click();
    await page.getByRole("button", { name: /^이 값 검증/ }).click();
    await page.getByRole("button", { name: "검증 추가", exact: true }).click();
    await secondStep.locator("details.api-verification-item > summary").click();
    // A wrapping label names the select with its chosen option too ("검증 방식 존재하는지").
    await secondStep.getByRole("combobox", { name: /^검증 방식/ }).selectOption("equals");
    await secondStep.getByRole("button", { name: "앞 단계 값", exact: true }).click();
    const expectLink = page.getByRole("dialog", { name: "/id 값 연결", exact: true });
    await expect(expectLink).toContainText("2단계 · 검증 /id 기대값");
    // Request values: only runtime inputs, globals and links can be picked (a fixed value would just be typed).
    await expect(expectLink.getByRole("button", { name: "/loginId string 값 선택", exact: true })).toBeEnabled();
    await expect(expectLink.getByRole("button", { name: "/loginId string 값 선택", exact: true })).toHaveText('"loginId"');
    await expectLink.getByRole("tab", { name: "응답값", exact: true }).click();
    await expectLink.getByRole("button", { name: "/id integer 값 선택", exact: true }).click();
    await expectLink.getByRole("button", { name: "이 값으로 연결", exact: true }).click();
    await expect(secondStep.locator(".api-expect-linked-value")).toContainText("1단계 응답 id");
    await expect(secondStep.locator("details.api-verification-item > summary")).toContainText("기대값과 같은지 [1단계 응답 id]");
    await shot("compose");
    await page.getByRole("button", { name: "시나리오 검사·저장", exact: true }).click();
    await expect(page.getByText("시나리오를 저장했습니다. 이 화면에서 계속 수정할 수 있습니다.", { exact: true })).toBeVisible();
    await expect(page.getByText("시나리오 수정 · 로그인 후 상품 조회", { exact: true })).toBeVisible();

    // Run the saved scenario.
    await page.getByRole("button", { name: "시나리오 목록으로", exact: true }).click();
    await page.getByRole("button", { name: /로그인 후 상품 조회/ }).click();
    await page.getByRole("button", { name: "실행", exact: true }).click();
    const inputDialog = page.getByRole("dialog", { name: "loginId 입력", exact: true });
    await expect(inputDialog).toContainText("1/2단계");
    // Cancel while the API is waiting for input, then start a fresh request through the real IPC.
    const inputScope = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting;
      const project = (await api.listProjects()).find(item => item.name === "쇼핑몰 QA")!;
      return { projectId: project.id, environmentId: project.environments[0].id };
    });
    const pendingInput = () => page.evaluate(scope => (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting.getPendingScenarioInput(scope), inputScope);
    const firstInput = await pendingInput();
    if (!firstInput) throw new Error("First input request is missing");
    const loginCallsBefore = loginInputs.length;
    await inputDialog.getByRole("textbox").fill("abandoned-input");
    await inputDialog.getByRole("button", { name: "실행 중단", exact: true }).click();
    await expect(inputDialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "다시 실행", exact: true })).toBeEnabled();
    expect(await pendingInput()).toBeNull();
    expect(loginInputs).toHaveLength(loginCallsBefore);
    await page.getByRole("button", { name: "다시 실행", exact: true }).click();
    await expect(inputDialog).toBeVisible();
    await expect(inputDialog.getByRole("textbox")).toHaveValue("");
    const nextInput = await pendingInput();
    if (!nextInput) throw new Error("Retry input request is missing");
    expect(nextInput.requestId).not.toBe(firstInput.requestId);
    expect(nextInput.runId).not.toBe(firstInput.runId);
    const lateSubmission = await page.evaluate(async ({ scope, request }) => {
      const api = (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting;
      try {
        await api.submitScenarioInput(scope, { requestId: request.requestId, runId: request.runId, stepId: request.stepId, name: request.name, value: "late-old-input" });
        return "accepted";
      } catch (error) { return (error as Error).message; }
    }, { scope: inputScope, request: firstInput });
    expect(lateSubmission).toContain("실행 중인 입력 요청이 아닙니다");
    expect((await pendingInput())?.requestId).toBe(nextInput.requestId);
    expect(loginInputs).toHaveLength(loginCallsBefore);
    await inputDialog.getByRole("textbox").fill("tester");
    await inputDialog.getByRole("button", { name: "입력 완료 · 계속", exact: true }).click();
    const result = page.getByRole("region", { name: "시나리오 실행 결과" });
    await expect(result).toContainText("통과");
    expect(loginInputs).toHaveLength(loginCallsBefore + 1);
    expect(loginInputs.at(-1)).toBe("tester");
    expect(await pendingInput()).toBeNull();
    // Each check is reported: step 1 has its two checks, step 2 only the automatic 2xx.
    await expect(result.locator(".api-run-checks").nth(0)).toContainText("2개 모두 통과");
    await expect(result.locator(".api-run-checks").nth(1)).toContainText("2xx (자동 확인)");
    await expect(result.locator(".api-run-checks").nth(1)).toContainText("/id기대값과 같은지 [1단계 응답 id]");
    await shot("run-result");
    // The session cookie from login reaches the next request.
    await expect(result).toContainText("SESSION=desktop-session");
    // Like Swagger, results show values as they are (no masking toggle any more).
    await expect(page.getByRole("switch", { name: "민감값 숨기기" })).toHaveCount(0);
    const tokenText = result.locator("span", { hasText: "login-secret-token" }).last();
    if (await tokenText.evaluate(node => getComputedStyle(node).webkitTextSecurity) === "disc") throw new Error("Result values are masked");

    // The extracted token and the session cookie are shared by the project.
    await page.getByRole("button", { name: "{ } 전역변수", exact: true }).click();
    await shot("globals");
    const tokenRow = globals.locator(".api-global-row").filter({ hasText: "accessToken" });
    await expect(tokenRow).toBeVisible();
    // Values in the globals panel start hidden; [값 보기] shows them.
    const tokenValue = tokenRow.locator(".api-global-value");
    await expect(tokenValue).toHaveText("login-secret-token");
    await expect(tokenValue).toHaveCSS("-webkit-text-security", "disc");
    await globals.getByRole("button", { name: "값 보기", exact: true }).click();
    await expect(tokenValue).toHaveCSS("-webkit-text-security", "none");
    await globals.getByRole("button", { name: "값 숨기기", exact: true }).click();
    await expect(globals.getByRole("region", { name: "세션 쿠키" })).toContainText("SESSION");
    await expect(globals.getByRole("region", { name: "세션 쿠키" })).not.toContainText("desktop-session");
    await page.keyboard.press("Escape");
    // After a run, picking a response value shows what that run returned next to each field.
    await page.getByRole("button", { name: "수정", exact: true }).click();
    await page.locator(".api-compose-steps button").nth(1).click();
    const linkedCheck = page.locator('details[aria-label="편집 단계 2"] details.api-verification-item');
    await page.locator('details[aria-label="편집 단계 2"] > summary').click();
    await linkedCheck.locator("> summary").click();
    await linkedCheck.getByRole("button", { name: "바꾸기", exact: true }).click();
    const runValues = page.getByRole("dialog", { name: "/id 값 연결", exact: true });
    await runValues.getByRole("tab", { name: "응답값", exact: true }).click();
    await expect(runValues).toContainText("값은 최근 실행 결과입니다 (HTTP 200).");
    await expect(runValues.locator(".api-value-json-line").filter({ has: page.getByRole("button", { name: "/id integer 값 선택", exact: true }) })).toContainText(": 7");
    await runValues.getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 목록으로", exact: true }).click();
    await page.getByRole("button", { name: /로그인 후 상품 조회/ }).click();
    // The run flow lists the checks with the editor's labels.
    await page.getByRole("button", { name: "실행 흐름", exact: true }).click();
    await page.getByRole("button", { name: "모두 펼치기", exact: true }).first().click();
    const flow = page.getByRole("region", { name: "시나리오 실행 흐름" });
    await expect(flow).toContainText("HTTP 상태");
    await expect(flow).toContainText("존재하는지");
    // A copy opens in place and is deleted from its detail view.
    await page.getByRole("button", { name: "복제", exact: true }).click();
    await expect(page.getByRole("heading", { name: "로그인 후 상품 조회 사본", exact: true })).toBeVisible();
    // Copying again (even a copy) numbers the name instead of repeating it.
    await page.getByRole("button", { name: "복제", exact: true }).click();
    await expect(page.getByRole("heading", { name: "로그인 후 상품 조회 사본 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "시나리오 삭제", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 삭제 확인", exact: true }).click();
    await page.getByRole("button", { name: "로그인 후 상품 조회 사본", exact: true }).click();
    await expect(page.getByRole("heading", { name: "로그인 후 상품 조회 사본", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "시나리오 삭제", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 삭제 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: /로그인 후 상품 조회 사본/ })).toHaveCount(0);
    // Suites keep their run action in the header, like scenarios.
    await page.getByRole("button", { name: /AI 상점 흐름/ }).click();
    await expect(page.getByRole("button", { name: "실행", exact: true })).toBeEnabled();
    await shot("suite");
    // A saved suite opens as a view; its order is edited after [수정], and an unsaved order blocks running.
    await expect(page.getByRole("region", { name: "스위트 구성" })).toContainText("AI 로그인");
    await page.getByRole("button", { name: "수정", exact: true }).click();
    await page.getByRole("button", { name: /^1번째 AI 로그인 순서 변경$/ }).press("ArrowDown");
    await expect(page.locator(".api-suite-order").nth(0)).toContainText("AI 상품 조회");
    await expect(page.getByRole("button", { name: "실행", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: /^2번째 AI 로그인 순서 변경$/ }).press("ArrowUp");
    await expect(page.getByRole("button", { name: "실행", exact: true })).toBeEnabled();
    // And the same mouse drag as the selected APIs.
    const suiteRows = page.locator(".api-suite-order");
    await startDrag(page.getByRole("button", { name: /^2번째 AI 상품 조회 순서 변경$/ }), suiteRows.nth(0));
    await page.mouse.up();
    await expect(suiteRows.nth(0)).toContainText("AI 상품 조회");
    await page.getByRole("button", { name: /^2번째 AI 로그인 순서 변경$/ }).press("ArrowUp");
    await expect(suiteRows.nth(0)).toContainText("AI 로그인");
    // Suite results list each check too.
    await page.getByRole("button", { name: "실행", exact: true }).click();
    const suiteResult = page.getByRole("region", { name: "스위트 실행 결과" });
    await expect(suiteResult).toContainText("실행 결과 · 통과");
    await suiteResult.locator("summary").first().click();
    await expect(suiteResult).toContainText("✓ HTTP 상태 2xx (자동 확인)");
    // Save through the actual native report IPC and check the file, not just the render helper.
    const suiteReportFile = path.join(dir, "suite-report.html");
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as unknown as typeof dialog.showSaveDialog;
    }, suiteReportFile);
    await suiteResult.getByRole("button", { name: "HTML 리포트 받기", exact: true }).click();
    await expect.poll(() => readFile(suiteReportFile, "utf8").catch(() => "")).toContain("<!doctype html>");
    const suiteReportHtml = await readFile(suiteReportFile, "utf8");
    expect(suiteReportHtml).toContain("AI 상점 흐름");
    expect(suiteReportHtml).toContain("POST /login");
    expect(suiteReportHtml).toContain("GET /items/{id}");
    expect(suiteReportHtml).not.toMatch(/login-secret-token|hidden-secret|desktop-session|desktop-api-token|Authorization|Bearer/);
    // A suite made in the app: the same scenario twice, saved, then deleted back to another suite.
    await page.getByRole("button", { name: "+ 새 스위트", exact: true }).click();
    await page.getByLabel("스위트 이름", { exact: true }).fill("화면에서 만든 스위트");
    // One AI 로그인 to pick: the earlier same-name draft was not saved.
    await expect(page.getByRole("combobox", { name: /^시나리오 추가/ }).locator("option", { hasText: "AI 로그인" })).toHaveCount(1);
    await page.getByRole("combobox", { name: /^시나리오 추가/ }).selectOption({ label: "AI 로그인" });
    await page.getByRole("combobox", { name: /^시나리오 추가/ }).selectOption({ label: "AI 로그인" });
    await expect(page.locator(".api-suite-order")).toHaveText(["1AI 로그인", "2AI 로그인"]);
    await page.getByRole("button", { name: "스위트 저장", exact: true }).click();
    await expect(page.getByRole("region", { name: "스위트 구성" })).toContainText("2개 시나리오");
    await page.getByRole("button", { name: "스위트 삭제", exact: true }).click();
    await page.getByRole("button", { name: "스위트 삭제 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: /화면에서 만든 스위트/ })).toHaveCount(0);
    // It shows another suite, not an empty new-suite form.
    await expect(page.getByRole("region", { name: "스위트 구성" })).toBeVisible();
    await expect(page.getByLabel("스위트 이름", { exact: true })).toHaveCount(0);
    // Scenarios are deleted from their detail view.
    await page.getByRole("button", { name: "AI 상품 조회", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 삭제", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 삭제 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: "AI 상품 조회", exact: true })).toHaveCount(0);
    // Decimal input goes through the form, real IPC and HTTP body as a number, not a string.
    await page.evaluate(async scope => {
      const api = (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting;
      await api.saveScenario(scope, [
        "id: decimal-input",
        "name: 소수 실행 입력",
        "server: 기본 API",
        "steps:",
        "  - name: 소수 전달",
        "    api: POST /login",
        "    auth: none",
        "    inputs: [{ name: decimalAmount, label: 금액 입력, type: number }]",
        "    body: { loginId: tester, amount: '{{inputs.decimalAmount}}' }",
      ].join("\n"), {});
    }, inputScope);
    await page.reload();
    await page.getByRole("button", { name: "API 테스트", exact: true }).click();
    await page.getByRole("tab", { name: "시나리오", exact: true }).click();
    await page.getByRole("button", { name: "소수 실행 입력", exact: true }).click();
    await page.getByRole("button", { name: "실행", exact: true }).click();
    const decimalDialog = page.getByRole("dialog", { name: "금액 입력", exact: true });
    await decimalDialog.getByRole("spinbutton", { name: "금액 입력", exact: true }).fill("1.5");
    await decimalDialog.getByRole("button", { name: "입력 완료 · 계속", exact: true }).click();
    await expect(decimalDialog).not.toBeVisible();
    await expect(page.getByRole("region", { name: "시나리오 실행 결과" })).toContainText("통과");
    expect(decimalInputs).toEqual([1.5]);
    expect(await pendingInput()).toBeNull();
    await page.getByRole("button", { name: "시나리오 삭제", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 삭제 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: "소수 실행 입력", exact: true })).toHaveCount(0);
    await shot("final");
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`], env });
    const restored = await app.firstWindow();
    restored.setDefaultTimeout(15_000);
    await restored.getByRole("button", { name: "API 테스트", exact: true }).click();
    await expect(restored.getByLabel("API 프로젝트")).toContainText("쇼핑몰 QA");
    // Leaving the project form with edits asks first.
    await restored.getByRole("button", { name: "프로젝트 설정", exact: true }).click();
    await restored.getByLabel("프로젝트 이름").fill("쇼핑몰 QA 수정");
    await restored.getByRole("button", { name: "← 돌아가기", exact: true }).click();
    await restored.getByRole("button", { name: "계속 수정", exact: true }).click();
    await expect(restored.getByLabel("프로젝트 이름")).toHaveValue("쇼핑몰 QA 수정");
    await restored.getByRole("button", { name: "← 돌아가기", exact: true }).click();
    await restored.getByRole("button", { name: "변경사항 버리고 나가기", exact: true }).click();
    await expect(restored.getByLabel("API 프로젝트")).toContainText("쇼핑몰 QA");
    await expect(restored.getByLabel("프로젝트 이름")).toHaveCount(0);
    await restored.getByRole("button", { name: "명세 설정", exact: true }).click();
    await expect(restored.getByLabel("OpenAPI URL", { exact: true })).toHaveValue(`${url}/openapi.json`);
    if (canRemember) {
      await expect(restored.getByLabel("Swagger 비밀번호", { exact: true })).toHaveValue("");
      await restored.getByRole("button", { name: "명세 새로고침", exact: true }).click();
      await expect(restored.getByText(/최근 동기화 성공/)).toBeVisible();
      await restored.getByRole("button", { name: "저장된 계정 삭제", exact: true }).click();
      await expect(restored.getByRole("button", { name: "저장된 계정 삭제", exact: true })).not.toBeVisible();
      // Without a remembered account, refreshing asks for the password instead of failing with 401.
      await restored.getByRole("button", { name: "명세 새로고침", exact: true }).click();
      await expect(restored.getByText("계정을 기억하지 않아 비밀번호를 다시 입력해야 합니다", { exact: false })).toBeVisible();
      await expect(restored.getByLabel("Swagger 비밀번호", { exact: true })).toBeFocused();
    }
    await restored.getByRole("button", { name: "태그 모두 펼치기", exact: true }).click();
    await expect(restored.getByRole("button", { name: /GET.*items/ })).toBeVisible();
    // "Try it out" values from the previous run come back after a restart, and can be forgotten.
    await restored.getByRole("button", { name: /GET.*items/ }).click();
    await restored.getByRole("button", { name: "Try it out", exact: true }).click();
    await expect(restored.getByLabel("path id", { exact: true })).toHaveValue("7");
    await expect(restored.getByRole("status").filter({ hasText: "마지막으로 실행한 값을 채웠습니다" })).toBeVisible();
    await restored.getByRole("button", { name: "기억한 값 지우기", exact: true }).click();
    await expect(restored.getByLabel("path id", { exact: true })).toHaveValue("");
    await expect(restored.getByText("마지막으로 실행한 값을 채웠습니다", { exact: false })).toHaveCount(0);
    await restored.getByRole("button", { name: "Cancel", exact: true }).click();
    await restored.getByRole("button", { name: /GET.*items/ }).click();
    await restored.getByRole("tab", { name: "시나리오", exact: true }).click();
    await expect(restored.getByRole("button", { name: /로그인 후 상품 조회/ })).toBeVisible();
    await expect(restored.getByRole("button", { name: "AI 상품 조회", exact: true })).toHaveCount(0);
    await restored.getByRole("button", { name: "{ } 전역변수", exact: true }).click();
    await expect(restored.getByText("저장된 변수가 없습니다.", { exact: true })).toBeVisible();
    await restored.keyboard.press("Escape");
    // Refreshing a spec whose title changed offers to rename steps still named after the old title.
    itemsTitle = "상품 정보 조회";
    await restored.getByRole("tab", { name: /^API 문서/ }).click();
    const refreshedSource = restored.getByRole("region", { name: "API 명세 가져오기" });
    const refreshSpec = async () => {
      if (!(await restored.getByLabel("OpenAPI URL").isVisible())) await restored.getByRole("button", { name: "명세 설정", exact: true }).click();
      await restored.getByLabel("Swagger 인증 방식").selectOption("basic");
      await restored.getByLabel("Swagger 아이디", { exact: true }).fill("docs-user");
      await restored.getByLabel("Swagger 비밀번호", { exact: true }).fill("docs-test-password");
      await refreshedSource.getByRole("button", { name: "이 URL로 가져오기", exact: true }).click();
    };
    await refreshSpec();
    await expect(refreshedSource).toContainText("API 제목이 바뀌었습니다 · 시나리오 1개의 단계 1개가 이전 제목을 이름으로 씁니다.");
    // "이대로 두기" keeps the old name and hides the suggestion; a later, different title asks again.
    await refreshedSource.getByText("바뀔 내용 보기", { exact: true }).click();
    if (process.env.CHECKLY_E2E_SHOTS) await restored.screenshot({ path: path.join(process.env.CHECKLY_E2E_SHOTS, "rename-offer.png") });
    await refreshedSource.getByRole("button", { name: "로그인 후 상품 조회 이름 그대로 두기", exact: true }).click();
    await expect(refreshedSource).not.toContainText("API 제목이 바뀌었습니다");
    itemsTitle = "상품 상세 정보 조회";
    await refreshSpec();
    await expect(refreshedSource).toContainText("API 제목이 바뀌었습니다 · 시나리오 1개의 단계 1개가 이전 제목을 이름으로 씁니다.");
    await refreshedSource.getByRole("button", { name: "새 제목으로 바꾸기", exact: true }).click();
    await expect(refreshedSource).toContainText("시나리오 1개의 단계 이름을 새 제목으로 바꿨습니다.");
    await expect(refreshedSource).not.toContainText("API 제목이 바뀌었습니다");
    // A refreshed spec that drops a path a saved scenario uses is flagged right away.
    itemsPath = "/products/{id}";
    await refreshSpec();
    await expect(refreshedSource.getByRole("alert")).toContainText("시나리오 1개가 명세에 없는 API를 씁니다");
    await refreshedSource.getByRole("alert").locator("summary").click();
    await expect(refreshedSource.getByRole("alert")).toContainText("로그인 후 상품 조회 · 상품 상세 정보 조회 (GET /items/{id})");
    // The scenario name in the warning opens it in the editor.
    await refreshedSource.getByRole("button", { name: "로그인 후 상품 조회", exact: true }).click();
    await expect(restored.getByText("시나리오 수정 · 로그인 후 상품 조회", { exact: true })).toBeVisible();
    // The scenario list marks it too.
    await restored.getByRole("button", { name: "시나리오 목록으로", exact: true }).click();
    const warnedEntry = restored.locator(".api-sidebar-entry").filter({ hasText: "로그인 후 상품 조회" });
    await expect(warnedEntry.locator(".api-sidebar-warning")).toHaveCount(1);
    // "API 바꾸기" points the step at the renamed path, keeping its values; saving clears the warning.
    await warnedEntry.click();
    await restored.getByRole("button", { name: "수정", exact: true }).click();
    await restored.locator(".api-compose-steps button").nth(1).click();
    // The step whose API left the spec opens by itself.
    await expect(restored.locator('details[aria-label="편집 단계 2"]')).toHaveAttribute("open", "");
    await expect(restored.locator('details[aria-label="편집 단계 2"] .api-step-missing')).toHaveText("명세에 없음");
    await expect(restored.getByText("명세에 없는 API입니다", { exact: false })).toBeVisible();
    await restored.getByRole("button", { name: "2단계 API 바꾸기", exact: true }).click();
    const replaceDialog = restored.getByRole("dialog", { name: "2단계 API 바꾸기" });
    await replaceDialog.getByLabel("바꿀 API 검색").fill("products");
    await replaceDialog.getByRole("button", { name: /\/products\/\{id\}/ }).click();
    await expect(restored.getByText("명세에 없는 API입니다", { exact: false })).toHaveCount(0);
    await expect(restored.locator('details[aria-label="편집 단계 2"]')).toContainText("값 연결");
    await restored.getByRole("button", { name: "시나리오 검사·저장", exact: true }).click();
    await expect(restored.getByText("시나리오를 저장했습니다. 이 화면에서 계속 수정할 수 있습니다.", { exact: true })).toBeVisible();
    await restored.getByRole("button", { name: "시나리오 목록으로", exact: true }).click();
    await expect(warnedEntry.locator(".api-sidebar-warning")).toHaveCount(0);
    // Moving a step with a body to an API without one lists the whole body so it can be removed.
    await warnedEntry.click();
    await restored.getByRole("button", { name: "수정", exact: true }).click();
    await restored.locator(".api-compose-steps button").nth(1).click();
    await restored.locator('details[aria-label="편집 단계 1"] > summary').click();
    await restored.getByRole("button", { name: "1단계 API 바꾸기", exact: true }).click();
    const replaceFirst = restored.getByRole("dialog", { name: "1단계 API 바꾸기" });
    await replaceFirst.getByLabel("바꿀 API 검색").fill("products");
    await replaceFirst.getByRole("button", { name: /\/products\/\{id\}/ }).click();
    const staleBody = restored.locator('details[aria-label="편집 단계 1"] .api-extra-fields');
    await expect(staleBody).toContainText("body (요청 본문 전체)");
    if (process.env.CHECKLY_E2E_SHOTS) { await staleBody.scrollIntoViewIfNeeded(); await restored.screenshot({ path: path.join(process.env.CHECKLY_E2E_SHOTS, "stale-body.png") }); }
    await staleBody.getByRole("button", { name: "제거", exact: true }).click();
    await expect(staleBody).toHaveCount(0);
    // Closing the window with unsaved edits asks first; "계속 수정" keeps the window and the edits.
    await app.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { unloadAsks: number };
      state.unloadAsks = 0;
      dialog.showMessageBoxSync = (() => { state.unloadAsks++; return 0; }) as typeof dialog.showMessageBoxSync;
    });
    // The main process answers the beforeunload itself; stop Playwright from also trying to (it throws).
    restored.on("dialog", () => undefined);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => app!.evaluate(() => (globalThis as unknown as { unloadAsks: number }).unloadAsks)).toBe(1);
    await expect(staleBody).toHaveCount(0);
    await expect(restored.getByText("저장 안 됨", { exact: false })).toBeVisible();
    // Leave without saving so the app closes cleanly.
    await restored.getByRole("button", { name: "시나리오 목록으로", exact: true }).click();
    await restored.getByRole("button", { name: "변경사항 버리고 닫기", exact: true }).click();
    await expect(warnedEntry).toBeVisible();
    // A project exports to one share file and imports back as a new project.
    const shareFile = path.join(dir, "share.checkly-api.json");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as unknown as typeof dialog.showSaveDialog;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as unknown as typeof dialog.showOpenDialog;
    }, shareFile);
    await restored.getByRole("button", { name: "프로젝트 설정", exact: true }).click();
    await restored.getByRole("button", { name: "프로젝트 내보내기", exact: true }).click();
    await expect(restored.getByRole("status").filter({ hasText: "저장했습니다" })).toContainText(shareFile);
    const shared = await readFile(shareFile, "utf8");
    if (shared.includes("desktop-api-token") || shared.includes("docs-test-password")) throw new Error("Share file carries secrets");
    await restored.getByRole("button", { name: "← 돌아가기", exact: true }).click();
    await restored.getByLabel("API 프로젝트").selectOption({ label: "+ 새 프로젝트" });
    await restored.getByRole("button", { name: "파일에서 가져오기", exact: true }).click();
    // The original is on this machine too, so it asks; a second copy is what this step wants.
    const firstImport = restored.getByRole("dialog", { name: "프로젝트 가져오기" });
    await expect(firstImport).toContainText("대상 · 쇼핑몰 QA");
    await firstImport.getByLabel("새 프로젝트로 추가").check();
    await firstImport.getByRole("button", { name: "새 프로젝트로 가져오기", exact: true }).click();
    const importNotice = restored.getByRole("status").filter({ hasText: "프로젝트를 가져왔습니다" });
    await expect(importNotice).toContainText("‘쇼핑몰 QA (2)’");
    // The notice names the actual button, and stays on API 문서 (not over the scenario screens).
    await expect(importNotice).toContainText("[이 URL로 가져오기]");
    await expect(restored.getByLabel("API 프로젝트").locator("option:checked")).toHaveText("쇼핑몰 QA (2)");
    await expect(restored.getByRole("tab", { name: /^API 문서/ })).toHaveAttribute("aria-selected", "true");
    // The imported project works once its spec is refreshed from the carried URL: the scenario runs.
    await expect(refreshedSource).toContainText("/openapi.json");
    await restored.getByRole("tab", { name: "시나리오", exact: true }).click();
    await expect(importNotice).toHaveCount(0);
    await restored.getByRole("tab", { name: /^API 문서/ }).click();
    await expect(importNotice).toBeVisible();
    await refreshSpec();
    await expect(refreshedSource).toContainText("최근 동기화 성공");
    // Every server now has its spec: the notice has done its job.
    await expect(importNotice).toHaveCount(0);
    await restored.getByRole("tab", { name: "시나리오", exact: true }).click();
    await expect(restored.locator(".api-sidebar-entry").filter({ hasText: "로그인 후 상품 조회" })).toBeVisible();
    await restored.getByRole("button", { name: /로그인 후 상품 조회/ }).click();
    await restored.getByRole("button", { name: "실행", exact: true }).click();
    const importedInput = restored.getByRole("dialog", { name: "loginId 입력", exact: true });
    await importedInput.getByRole("textbox").fill("tester");
    await importedInput.getByRole("button", { name: "입력 완료 · 계속", exact: true }).click();
    await expect(restored.getByRole("region", { name: "시나리오 실행 결과" })).toContainText("통과");
    // The copy's file (with one more scenario) goes back into the original through the update dialog.
    await restored.getByRole("button", { name: "프로젝트 설정", exact: true }).click();
    await restored.getByRole("button", { name: "프로젝트 내보내기", exact: true }).click();
    await expect(restored.getByRole("status").filter({ hasText: "저장했습니다" })).toBeVisible();
    await restored.getByRole("button", { name: "← 돌아가기", exact: true }).click();
    const copyFile = JSON.parse(await readFile(shareFile, "utf8")) as { scenarios: Array<{ id: string; name: string; source: string }> };
    const extra = copyFile.scenarios[0];
    copyFile.scenarios.push({ ...extra, id: "shared/extra", name: "공유로 추가된 시나리오", source: extra.source.replace(/^id: .*$/m, "id: shared/extra").replace(/^name: .*$/m, "name: 공유로 추가된 시나리오") });
    await writeFile(shareFile, JSON.stringify(copyFile));
    await restored.getByRole("button", { name: "프로젝트 설정", exact: true }).click();
    await restored.getByRole("button", { name: "가져오기", exact: true }).click();
    const importDialog = restored.getByRole("dialog", { name: "프로젝트 가져오기" });
    await importDialog.getByLabel("업데이트할 프로젝트").selectOption({ label: "쇼핑몰 QA" });
    await expect(importDialog).toContainText("추가 1");
    if (process.env.CHECKLY_E2E_SHOTS) await restored.screenshot({ path: path.join(process.env.CHECKLY_E2E_SHOTS, "project-import.png") });
    await importDialog.getByRole("button", { name: "업데이트", exact: true }).click();
    await expect(restored.getByRole("status").filter({ hasText: "에 합쳤습니다" })).toContainText("‘쇼핑몰 QA’에 합쳤습니다 · 추가 1");
    await expect(restored.getByLabel("API 프로젝트").locator("option:checked")).toHaveText("쇼핑몰 QA");
    // It keeps the copied scenario's group, which starts folded in the sidebar.
    await expect(restored.locator(".api-sidebar-entry").filter({ hasText: "공유로 추가된 시나리오" })).toHaveCount(1);
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
