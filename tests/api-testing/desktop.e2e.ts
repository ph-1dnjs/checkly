import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
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
    if (req.url === "/openapi.json") res.end(JSON.stringify({ openapi: "3.0.3", info: { title: "로컬 상품 API", version: "1.0" }, paths: { "/items/{id}": { get: { summary: "상품 상세 조회", description: "상품 번호로 이름과 가격을 확인합니다.", parameters: [{ name: "id", in: "path", required: true, description: "조회할 상품 번호", schema: { type: "integer" } }], responses: { "200": { description: "조회 성공", content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, price: { type: "integer" } } } } } } } } } } }));
    else res.end(JSON.stringify({ id: 7, name: "테스트 상품", price: 12000, accessToken: "hidden-secret" }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`], env });
    const page = await app.firstWindow();
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
    const authVariable = await page.getByLabel("API 인증 전역 변수", { exact: true }).inputValue();
    await page.getByRole("button", { name: "인증 해제", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "API 요청 인증", exact: true })).toContainText("연결된 인증 없음");
    await page.getByLabel("API 인증 전역 변수", { exact: true }).selectOption(authVariable);
    await page.getByRole("button", { name: "인증에 연결", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "API 요청 인증", exact: true })).toContainText(`연결: globals.${authVariable}`);
    await page.screenshot({path:"/tmp/checkly-api-auth.png",fullPage:true});
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
    await page.getByRole("button", { name: "{ } 전역 변수", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "{ } 전역 변수", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "{ } 전역 변수", exact: true })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "{ } 전역 변수", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "{ } 전역 변수", exact: true }).click();
    await page.getByLabel("전역변수 이름", { exact: true }).fill("sampleId");
    await page.getByLabel("전역변수 형식", { exact: true }).selectOption("json");
    await page.getByLabel("전역변수 값", { exact: true }).fill("7");
    await page.getByRole("button", { name: "전역변수 저장", exact: true }).click();
    await expect(page.locator(".api-global-row").filter({hasText:"sampleId"})).toContainText("sampleId");
    await page.getByRole("button", { name: "{ } 전역 변수", exact: true }).click();
    await page.getByRole("tab", { name: "AI 작성 도우미", exact: true }).click();
    await page.getByLabel("AI 시나리오 업무 목표", { exact: true }).fill("상품 상세 조회를 검증해줘");
    await page.getByRole("checkbox", { name: /items/ }).check();
    await page.getByRole("button", { name: "AI 전달 정보 미리보기", exact: true }).click();
    await expect(page.getByLabel("AI 전달 정보", { exact: true })).toHaveValue(/sampleId/);
    const context = await page.getByLabel("AI 전달 정보", { exact: true }).inputValue();
    if (context.includes(url)) throw new Error("Actual base URL leaked into AI export");
    await page.getByRole("button", { name: "AI 작성용 정보 복사", exact: true }).click();
    await expect(page.getByText("AI 작성용 정보를 복사했습니다. 외부 AI에 붙여넣으세요.", { exact: true })).toBeVisible();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (copied !== context) throw new Error("AI clipboard differs from preview");
    await page.getByRole("tab", { name: "시나리오", exact: true }).click();
    await expect(page.getByLabel("시나리오 YAML", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "+ 새 시나리오", exact: true }).click();
    await expect(page.getByRole("tab", { name: "시나리오 작성", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "작성 닫기", exact: true }).click();
    await page.getByLabel("시나리오 YAML", { exact: true }).fill(`version: 1
id: product/read
name: 상품 조회 시나리오
description: 전역변수의 상품 번호를 사용합니다.
steps:
  - id: read
    name: 상품 상세 확인
    description: 상품 ID와 이름을 확인합니다.
    server: member
    api: { method: GET, path: '/items/{id}' }
    request:
      pathParams: { id: '{{globals.sampleId}}' }
    extract:
      - { source: body, pointer: /id, target: vars.itemId }
`);
    await page.getByRole("button", { name: "검사·미리보기", exact: true }).click();
    await page.getByLabel("서버 연결 member", { exact: true }).selectOption({ label: "기본 API" });
    await page.getByRole("button", { name: "시나리오 저장", exact: true }).click();
    await expect(page.getByText("시나리오를 저장했습니다.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("시나리오 YAML", { exact: true })).not.toBeVisible();
    await page.getByRole("tab", { name: "시나리오", exact: true }).click();
    await page.getByRole("button", { name: /상품 조회 시나리오/ }).click();
    await page.getByRole("button", { name: "시나리오 수정", exact: true }).click();
    await expect(page.getByRole("tab", { name: "시나리오 작성", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("complementary", { name: "선택한 API", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "작성 닫기", exact: true }).click();
    await page.getByRole("tab", { name: "시나리오", exact: true }).click();
    await page.getByRole("button", { name: /상품 조회 시나리오/ }).click();
    await page.getByRole("button", { name: "선택한 API 테스트 실행", exact: true }).click();
    await expect(page.getByRole("region", { name: "시나리오 실행 결과" })).toContainText("passed");
    await expect(page.getByRole("region", { name: "시나리오 실행 결과" })).toContainText("itemId");
    await expect(page.getByRole("region", { name: "시나리오 실행 결과" })).not.toContainText("hidden-secret");
    await page.getByRole("button", { name: "+ 새 시나리오", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "선택한 API", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "시나리오에 API 추가", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "시나리오에 API 추가", exact: true }).click();
    await page.getByRole("button", { name: "시나리오에 API 추가", exact: true }).click();
    await page.getByRole("button", { name: "선택 완료 · 시나리오 편집", exact: true }).click();
    await page.locator('details[aria-label="편집 단계 1"] > summary').click();
    await page.getByLabel("시나리오 이름", { exact: true }).fill("화면에서 만든 상품 흐름");
    await page.getByLabel("시나리오 설명", { exact: true }).fill("첫 응답 ID를 두 번째 요청으로 전달합니다.");
    await page.getByLabel("1단계 id", { exact: true }).fill("7");
    await page.getByRole("button", { name: /200 · \/id/ }).first().click();
    await page.getByLabel("1단계 응답 연결 대상", { exact: true }).selectOption({ label: "2. 상품 상세 조회 → pathParams.id" });
    await page.getByRole("button", { name: "요청값에 연결", exact: true }).click();
    await page.getByRole("button", { name: "시나리오 검사·저장", exact: true }).click();
    await expect(page.getByText("시나리오를 저장했습니다. 이 화면에서 계속 수정할 수 있습니다.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "작성 닫기", exact: true }).click();
    await expect(page.getByRole("button", { name: "선택한 API 테스트 실행", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "선택한 API 테스트 실행", exact: true }).click();
    await expect(page.getByRole("region", { name: "시나리오 실행 결과" })).toContainText("passed");
    await expect(page.getByRole("region", { name: "시나리오 실행 결과" })).toContainText("response_");
    await page.screenshot({ path: "/tmp/checkly-api-testing-desktop.png", fullPage: true });
    await app.close();
    app = await electron.launch({ args: [".", `--user-data-dir=${dir}`], env });
    const restored = await app.firstWindow();
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
    await expect(restored.getByRole("button", { name: /상품 조회 시나리오/ })).toBeVisible();
    await restored.getByRole("button", { name: "{ } 전역 변수", exact: true }).click();
    await expect(restored.getByText("저장된 변수가 없습니다.", { exact: true })).toBeVisible();
  } finally {
    try {
      const process = app?.process();
      if (process && !process.killed) process.kill();
    } catch (error) { console.error(`Electron cleanup failed: ${(error as Error).message}`); }
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
}
void main();
