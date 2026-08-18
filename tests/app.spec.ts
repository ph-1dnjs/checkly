import { expect, test } from '@playwright/test'

test('restores markers and resumes a paused manual-input step without exposing the value', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '시나리오', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '마커 편집', exact: true }).click()
  await expect(page.getByRole('button', { name: '3번 인증번호 마커' })).toBeVisible()
  await page.getByRole('button', { name: '2번 단계 삭제' }).click()
  await expect(page.getByRole('button', { name: '2번 인증번호 마커' })).toBeVisible()

  await page.getByRole('button', { name: '변경사항 저장' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('autoqa-scenarios'))).toContain('# 시나리오: 주문 조회')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('autoqa-scenarios'))).not.toContain("이메일에 'qa@example.com' 입력")
  await page.getByRole('button', { name: '실행', exact: true }).click()
  await expect(page.getByRole('heading', { name: '수동 입력이 필요합니다' })).toBeVisible()
  await page.getByPlaceholder('입력값').fill('123456')
  await page.getByRole('button', { name: '입력 후 계속' }).click()
  await expect(page.getByText('시나리오 통과')).toBeVisible()
  await expect(page.getByText('123456')).toHaveCount(0)
})

test('edits a marker value and keeps an unmatched manual marker until it is reconnected', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '마커 편집', exact: true }).click()

  await page.getByRole('button', { name: '2번 이메일 마커' }).click()
  await page.getByLabel('값').fill('changed@example.com')
  await page.getByRole('button', { name: '수정 완료', exact: true }).click()

  await page.getByRole('button', { name: '3번 인증번호 마커' }).click()
  await page.getByLabel('연결 상태').selectOption('false')
  await page.getByRole('button', { name: '수정 완료', exact: true }).click()
  await expect(page.getByRole('button', { name: '수동 입력 인증번호 미연결 단계' })).toBeVisible()
  await page.getByRole('button', { name: '현재 요소에 재연결' }).click()
  await page.getByRole('button', { name: '변경사항 저장' }).click()

  await expect.poll(() => page.evaluate(() => localStorage.getItem('autoqa-scenarios'))).toContain("이메일에 'changed@example.com' 입력")
  await expect.poll(() => page.evaluate(() => localStorage.getItem('autoqa-scenarios'))).toContain('인증번호 수동 입력 [인증번호를 입력해 주세요.]')
})
