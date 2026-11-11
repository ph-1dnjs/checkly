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

const openSettings = async (page: import('@playwright/test').Page) => {
  await installAuthStub(page, { enabled: false })
  await page.goto('/')
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('button', { name: '설정' }).click()
  return page.locator('.settings-brand-footer')
}

test('배너가 Checkly Recorder 홍보에서 앱 소개로 자동으로 넘어가고 점으로 되돌릴 수 있다', async ({ page }) => {
  await page.clock.install()
  const banner = await openSettings(page)
  const store = banner.getByRole('link', { name: '바로가기' })
  const tagline = banner.getByText('반복되는 확인을 대신 맡습니다')
  await expect(store).toHaveAttribute('href', /chromewebstore\.google\.com\/detail\/afadfmcbnohkeoghelpfcpjkefngkold/)
  await expect(store).toBeInViewport()
  await expect(banner.getByRole('button', { name: /1번째 슬라이드/ })).toHaveAttribute('aria-current', 'true')

  await page.clock.runFor(5100)
  await expect(banner.getByRole('button', { name: /2번째 슬라이드/ })).toHaveAttribute('aria-current', 'true')
  await expect(store).toBeHidden()
  await expect(tagline).toBeInViewport()

  await banner.getByRole('button', { name: /1번째 슬라이드/ }).click()
  await expect(store).toBeInViewport()
})

test('배너를 왼쪽으로 끌면 다음 장, 오른쪽으로 끌면 이전 장으로 넘어간다', async ({ page }) => {
  await page.clock.install()
  const banner = await openSettings(page)
  const box = (await banner.boundingBox())!
  const y = box.y + 20
  const swipe = async (from: number, to: number) => {
    await page.mouse.move(from, y)
    await page.mouse.down()
    await page.mouse.move((from + to) / 2, y, { steps: 4 })
    await page.mouse.move(to, y, { steps: 4 })
    await page.mouse.up()
  }

  await swipe(box.x + box.width * 0.8, box.x + box.width * 0.3)
  await expect(banner.getByRole('button', { name: /2번째 슬라이드/ })).toHaveAttribute('aria-current', 'true')
  await swipe(box.x + box.width * 0.3, box.x + box.width * 0.8)
  await expect(banner.getByRole('button', { name: /1번째 슬라이드/ })).toHaveAttribute('aria-current', 'true')
})
