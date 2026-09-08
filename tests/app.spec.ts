import { expect, test } from '@playwright/test'

test('uses the dashboard and execution navigation layout', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        loadScenarioMarkdown: async () => null,
        loadMarkerPositions: async () => null,
        saveMarkerPositions: async () => undefined,
        listScenarioFolder: async () => ({ folderPath: null, files: [] }),
        readScenarioFile: async () => null,
        onManualInputRequired: () => () => undefined,
        onManualControlRequired: () => () => undefined,
        onManualResultRequired: () => () => undefined,
        onQaProgress: () => () => undefined,
        onQaPreview: () => () => undefined,
        onQaStepPreview: () => () => undefined,
        onRunVideo: () => () => undefined,
      },
    })
  })
  await page.goto('/')

  await expect(page.getByText('대시보드', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '실행 기록' })).toHaveCount(0)

  await page.getByRole('button', { name: '편집기' }).click()
  await page.getByRole('button', { name: 'Checkly' }).click()
  await expect(page.getByText('대시보드', { exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: '준비 중', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: '시나리오 선택 · 실행' }).click()

  await expect(page.getByText('시나리오 폴더를 선택해 주세요')).toBeVisible()

  await page.getByRole('button', { name: '시나리오 실행' }).click()
  await expect(
    page.getByRole('heading', { name: '시나리오를 실행할 수 없습니다' }),
  ).toBeVisible()
})
