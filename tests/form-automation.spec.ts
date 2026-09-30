import { expect, test } from "@playwright/test";

test("opens the isolated form automation tab", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "electronAPI", {
      value: {
        loadScenarioMarkdown: async () => null,
        loadMarkerPositions: async () => null,
        saveMarkerPositions: async () => undefined,
        onManualInputRequired: () => () => undefined,
        onManualControlRequired: () => () => undefined,
        onManualResultRequired: () => () => undefined,
        onQaProgress: () => () => undefined,
        onQaPreview: () => () => undefined,
        onQaStepPreview: () => () => undefined,
        onRunVideo: () => () => undefined,
        readFormAutomationSessionEvents: async () => [],
        saveFormAutomationSessionEvent: async () => true,
        clearFormAutomationSessionEvents: async () => true,
        captureFormAutomationPage: async () => ({
          dataUrl: `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#f5f7fa"/><rect x="24" y="24" width="272" height="152" rx="8" fill="#d9e7ff"/></svg>')}`,
          size: { width: 320, height: 200 },
        }),
      },
    });
  });

  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "폼 자동 완성" }).click();

  await expect(
    page.getByRole("heading", { name: "사이트를 보면서 폼을 자동으로 완성하세요" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "선택 케이스 자동 입력" })).toBeVisible();
  await expect(page.getByRole("button", { name: "화면 캡처" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Swagger 연결" })).toBeVisible();
  await expect(page.getByRole("button", { name: /네트워크/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /저장소/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /오버라이드/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "화면 축소" })).toBeVisible();
  await expect(page.getByRole("button", { name: "80%" })).toBeVisible();

  const contentBox = await page.locator(".content").boundingBox();
  expect(contentBox?.width).toBe(1920);

  await page.keyboard.press("Control+Shift+S");
  await expect(page.getByRole("dialog", { name: "화면 캡처 편집" })).toBeVisible();
  await expect(page.getByRole("button", { name: "영역 선택" })).toHaveAttribute("aria-pressed", "true");
  const captureCanvas = page.getByLabel("캡처 이미지 주석 영역");
  const fullCaptureBox = await captureCanvas.boundingBox();
  expect(fullCaptureBox).not.toBeNull();
  await page.mouse.move(fullCaptureBox!.x + 35, fullCaptureBox!.y + 25);
  await page.mouse.down();
  await page.mouse.move(fullCaptureBox!.x + 260, fullCaptureBox!.y + 155);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "펜" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => Number(await captureCanvas.getAttribute("width"))).toBeLessThan(320);
  const croppedCaptureBox = await captureCanvas.boundingBox();
  expect(croppedCaptureBox).not.toBeNull();
  await page.mouse.move(croppedCaptureBox!.x + 20, croppedCaptureBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(croppedCaptureBox!.x + 90, croppedCaptureBox!.y + 65);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "실행 취소" })).toBeEnabled();
  await page.getByRole("button", { name: "취소", exact: true }).click();

  await page.getByRole("button", { name: /자동 입력/ }).last().click();
  await expect(page.getByText("폼·검색 자동 입력 케이스")).toBeVisible();
});
