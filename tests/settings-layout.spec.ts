import { expect, test } from '@playwright/test'
import { installAuthStub } from './fixtures/auth-stub'

test('설정 콘텐츠가 내비게이션 뒤까지 이어지고 마지막 콘텐츠를 위로 스크롤할 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  await installAuthStub(page, { enabled: false })
  await page.goto('/')
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('button', { name: '설정' }).click()

  const scroll = page.locator('.settings-scroll')
  const footer = page.locator('.settings-brand-footer')
  const nav = page.getByRole('navigation', { name: '주요 메뉴' })
  await expect(footer).toBeAttached()
  const bounds = await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    return { bottom: element.getBoundingClientRect().bottom, scrollTop: element.scrollTop }
  })
  const footerBounds = await footer.boundingBox()
  const navBounds = await nav.boundingBox()
  expect(bounds.bottom).toBe(700)
  expect(bounds.scrollTop).toBeGreaterThan(0)
  expect(footerBounds!.y + footerBounds!.height).toBeLessThan(navBounds!.y)
})
