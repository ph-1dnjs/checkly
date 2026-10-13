import { installAuthStub, owner } from './fixtures/auth-stub'
import { expect, test } from '@playwright/test'

test('keeps the editor visible while its Markdown is temporarily blank', async ({ page }) => {
  await installAuthStub(page, { enabled: true, session: owner })
  await page.goto('/')
  await page.getByRole('button', { name: '시나리오 · 편집과 실행' }).click()
  await page.getByRole('tab', { name: '편집' }).click()

  const source = page.getByRole('textbox', { name: '시나리오 Markdown 원본' })
  await source.press('Enter')

  await expect(page.getByRole('tab', { name: '편집' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('시나리오 형식을 인식하지 못했습니다.')).toBeVisible()
})
