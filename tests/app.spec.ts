import { expect, test } from '@playwright/test'

test('shows a validation modal when running without a scenario', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'electronAPI', {
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
      },
    })
  })
  await page.goto('/')

  await page.getByRole('button', { name: '시나리오 실행' }).click()

  await expect(page.getByRole('heading', { name: '시나리오를 실행할 수 없습니다' })).toBeVisible()
  await expect(page.getByText('실행할 시나리오가 없습니다.')).toBeVisible()
})
