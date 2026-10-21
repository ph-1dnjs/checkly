import { expect, test } from '@playwright/test'
import { installAuthStub, owner } from './fixtures/auth-stub'

test('screen extraction restores each document and repeated step position without fabricated pins', async ({ page }) => {
  await installAuthStub(page, { enabled: true, session: owner })
  await page.goto('/')
  await page.evaluate(() => {
    const rows = [
      { title: '첫 문서', points: [{ x: 12, y: 24 }, { x: 65, y: 72 }] },
      { title: '다른 문서', points: [{ x: 31, y: 42 }, { x: 83, y: 91 }] },
      { title: '좌표 없는 문서', points: [] },
    ].map(({ title, points }, index) => ({
      id: `document-${index}`, title,
      markdown: `# 시나리오: ${title}\nurl: /login\n\nGiven \`로그인\` 클릭\nAnd \`로그인\` 클릭`,
      positions: JSON.stringify({ [`${title}\n/login`]: points.map(point => ({ action: 'click', target: '로그인', ...point })) }),
      updatedAt: '2026-10-13T00:00:00Z', createdBy: 'minsu', updatedBy: 'minsu',
    }))
    sessionStorage.setItem('web-scenarios', JSON.stringify(rows))
    window.electronAPI.inspectScenario = async scenario => scenario.steps.map(step => ({ id: step.id, connected: true }))
  })
  await page.getByRole('button', { name: '시나리오 · 편집과 실행' }).click()
  await page.getByRole('tab', { name: '편집', exact: true }).click()
  await page.locator('.scenario-files').getByRole('button', { name: '새로고침' }).click()
  for (const [title, points] of [
    ['첫 문서', [[12, 24], [65, 72]]],
    ['다른 문서', [[31, 42], [83, 91]]],
    ['좌표 없는 문서', []],
    ['첫 문서', [[12, 24], [65, 72]]],
  ] as const) {
    await page.locator('.scenario-files button').filter({ hasText: title }).click()
    await page.getByRole('button', { name: '화면 추출', exact: true }).click()
    const pins = page.locator('.extract-pin')
    await expect(pins).toHaveCount(points.length)
    for (const [index, [x, y]] of points.entries()) {
      await expect(pins.nth(index)).toHaveAttribute('style', new RegExp(`left: ${x}%; top: ${y}%;`))
    }
    await expect(page.getByText('저장 안 됨', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '텍스트', exact: true }).click()
    await page.getByRole('button', { name: '저장하지 않고 돌아가기' }).click()
  }
})

test('new marker survives saving and reopening when inspection cannot find its target', async ({ page }) => {
  await installAuthStub(page, { enabled: true, session: owner })
  await page.goto('/')
  await page.getByRole('button', { name: '시나리오 · 편집과 실행' }).click()
  await page.getByRole('tab', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: '새 시나리오', exact: true }).click()
  await page.getByRole('button', { name: '화면 추출', exact: true }).click()
  await page.getByRole('button', { name: '마커 추가', exact: true }).click()
  await page.getByLabel('마커를 추가할 위치').click({ position: { x: 100, y: 150 } })
  await page.getByRole('textbox', { name: '라벨', exact: true }).fill('로그인 후 표시되는 버튼')
  await page.getByRole('button', { name: '완료', exact: true }).click()
  const pin = page.locator('.extract-pin')
  await expect(pin).toHaveCount(1)
  const style = await pin.getAttribute('style')
  await page.getByRole('button', { name: '텍스트', exact: true }).click()
  await page.getByRole('button', { name: '저장 후 돌아가기' }).click()
  await expect(page.getByText('저장 안 됨', { exact: true })).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('web-scenarios')!)[0])
  expect(Object.values(JSON.parse(stored.positions)).flat()).toEqual([
    expect.objectContaining({ target: '로그인 후 표시되는 버튼', x: expect.any(Number), y: expect.any(Number) }),
  ])
  await page.reload()
  await page.getByRole('button', { name: '시나리오 · 편집과 실행' }).click()
  await page.getByRole('tab', { name: '편집', exact: true }).click()
  await page.locator('.scenario-files button[aria-pressed]').filter({ hasText: '새 시나리오' }).click()
  await page.getByRole('button', { name: '화면 추출', exact: true }).click()
  // 기본 mock inspect는 대상을 찾지 못한다. 연결 상태와 저장 좌표 표시는 독립적이어야 한다.
  await expect(page.locator('.extract-marker-link.unlinked')).toHaveCount(1)
  await expect(pin).toHaveCount(1)
  await expect(pin).toHaveAttribute('style', style!)
})
