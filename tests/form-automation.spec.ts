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
      },
    });
  });

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

  await page.getByRole("button", { name: /자동 입력/ }).last().click();
  await expect(page.getByText("폼·검색 자동 입력 케이스")).toBeVisible();
});
