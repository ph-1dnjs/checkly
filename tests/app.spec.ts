import { installAuthStub, owner } from './fixtures/auth-stub'
import { expect, test } from '@playwright/test'

test('uses the dashboard and execution navigation layout', async ({ page }) => {
  await installAuthStub(page, { enabled: true, session: owner })
  await page.goto('/')

  await expect(page.getByText('대시보드', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '실행 기록' })).toHaveCount(0)

  // 편집과 실행은 dock의 메뉴 하나로 묶이고, 작업공간 헤더의 탭으로 오간다.
  await page.getByRole('button', { name: '시나리오 · 편집과 실행' }).click()
  await page.getByRole('tab', { name: '편집' }).click()
  await expect(page.getByRole('tab', { name: '편집' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Checkly' }).click()
  await expect(page.getByText('대시보드', { exact: true })).toBeVisible()

  // The disabled "준비 중" placeholder was removed from the dock; every item is a real route.
  await expect(page.getByRole('button', { name: '준비 중', exact: true })).toHaveCount(0)

  // dock 메뉴는 작업공간에서 마지막으로 본 화면(편집)으로 돌아간다.
  await page.getByRole('button', { name: '시나리오 · 편집과 실행' }).click()
  await expect(page.getByRole('tab', { name: '편집' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /실행/ }).click()

  await expect(page.getByText('저장된 시나리오가 없습니다.')).toBeVisible()

  await page.getByRole('button', { name: '시나리오 실행', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '시나리오를 실행할 수 없습니다' }),
  ).toBeVisible()
})
