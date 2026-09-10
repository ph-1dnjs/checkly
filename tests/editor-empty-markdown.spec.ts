import { expect, test } from '@playwright/test'

test('keeps the editor visible while its Markdown is temporarily blank', async ({ page }) => {
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
  await page.getByRole('button', { name: '편집기' }).click()

  const source = page.getByRole('textbox', { name: '시나리오 Markdown 원본' })
  await source.press('Enter')

  await expect(page.getByRole('heading', { name: '시나리오 편집' })).toBeVisible()
  await expect(page.getByText('시나리오 형식을 인식하지 못했습니다.')).toBeVisible()
})
