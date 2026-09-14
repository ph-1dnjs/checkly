import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
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
  await page.getByRole('textbox', { name: '시나리오 Markdown 원본' }).fill([
    '# 시나리오: 로그인',
    'url: https://example.com',
    'tag: 인증',
    'Given `이메일`에 `original@example.com` 입력',
    'Then `환영합니다` 텍스트가 보인다',
  ].join('\n'))
})

test('duplicates multiple cases with defaults, tags and unique names', async ({ page }) => {
  await page.getByRole('button', { name: '복제', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '템플릿으로 복제' })
  await dialog.getByRole('textbox', { name: '복제본 이름' }).fill('로그인')
  await dialog.getByRole('textbox', { name: '이메일 값', exact: true }).fill('changed@example.com')
  await dialog.getByRole('button', { name: '+ 케이스 추가' }).click()
  await dialog.getByRole('textbox', { name: '환영합니다 값', exact: true }).fill('완료')
  await dialog.getByRole('button', { name: '2개 복제', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const source = page.getByRole('textbox', { name: '시나리오 Markdown 원본' })
  await expect(source).toHaveValue([
    '# 시나리오: 로그인',
    'url: https://example.com',
    'tag: 인증',
    'Given `이메일`에 `original@example.com` 입력',
    'Then `환영합니다` 텍스트가 보인다',
    '',
    '# 시나리오: 로그인 2',
    'url: https://example.com',
    'tag: 인증',
    '',
    'Given `이메일`에 `changed@example.com` 입력',
    'Then `환영합니다` 텍스트가 보인다',
    '',
    '# 시나리오: 로그인 3',
    'url: https://example.com',
    'tag: 인증',
    '',
    'Given `이메일`에 `original@example.com` 입력',
    'Then `완료` 텍스트가 보인다',
  ].join('\n'))
})

test('removes cases and resets the form after cancellation', async ({ page }) => {
  await page.getByRole('button', { name: '복제', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '템플릿으로 복제' })
  await dialog.getByRole('button', { name: '+ 케이스 추가' }).click()
  await dialog.getByRole('button', { name: '현재 케이스 삭제' }).click()
  await expect(dialog.getByRole('tab')).toHaveCount(1)
  await dialog.getByRole('textbox', { name: '이메일 값', exact: true }).fill('discard@example.com')
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await page.getByRole('button', { name: '복제', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '이메일 값', exact: true })).toHaveValue('')
  await expect(dialog.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: '시나리오 Markdown 원본' })).not.toHaveValue(/discard@example/)
})
