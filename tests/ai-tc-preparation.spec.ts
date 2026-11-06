import { expect, test } from '@playwright/test';
import { installAuthStub } from './fixtures/auth-stub';

test('TC별 준비 진행, 실패 후 재시도와 토큰 사용량을 표시한다', async ({ page }) => {
  await installAuthStub(page, { enabled: false });
  await page.addInitScript(() => {
    const rows = [1, 2, 3].map((n, index) => ({ row: index + 2, hidden: false, cells: { 1: `SC-TC0${n}`, 2: `단계 ${n}`, 3: `결과 ${n}` }, mergedFrom: [], formulaWithoutValue: [] }));
    const workbook = { fileName: 'qa.xlsx', sheets: [{ name: 'TC', hidden: false, headerRow: 1, headers: [{ col: 1, label: 'TC ID' }, { col: 2, label: '테스트 단계' }, { col: 3, label: '기대 결과' }], mapping: { id: 1, steps: 2, expected: 3 }, rows }] };
    let onUsage: (value: unknown) => void = () => {};
    let calls = 0;
    Object.assign(window.electronAPI, { aiTc: {
      current: async () => null, tools: async () => [{ tool: 'claude', version: 'test' }],
      onState: () => () => {}, onPreview: () => () => {}, onPrepareUsage: (fn: (value: unknown) => void) => { onUsage = fn; return () => {}; },
      importWorkbook: async () => ({ workbook }),
      prepare: async ({ cases }: { cases: Array<{ key: string; id: string }> }) => {
        calls++;
        sessionStorage.setItem('prep-calls', String(calls));
        if (calls === 1) await new Promise<void>(resolve => { (window as any).releasePreparation = resolve; });
        onUsage({ tool: 'claude', usage: { input: 10, output: 2, cachedInput: 3, cacheWrite: 4 } });
        if (cases[0]!.id === 'SC-TC02' && calls === 2) throw new Error('준비 실패');
        return cases.map(item => ({ key: item.key, data: [{ label: '제목', value: item.id }], files: [], note: '' }));
      },
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI TC 실행' }).click();
  await page.getByRole('button', { name: '엑셀 파일 선택' }).first().click();
  await page.getByRole('button', { name: /준비로 이동/ }).click();
  await expect(page.getByText(/0\/3 · SC-TC01 준비 중/)).toBeVisible();
  await expect(page.getByRole('button', { name: /세팅 대기/ })).toHaveCount(2);
  await page.evaluate(() => (window as any).releasePreparation());
  await expect(page.getByRole('button', { name: /세팅 실패/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /자동 세팅 1/ })).toHaveCount(2);
  await expect(page.getByLabel('토큰 사용량')).toContainText('준비 claude · 입력 30 · 출력 6');
  await page.getByRole('button', { name: /세팅 실패/ }).click();
  await page.getByRole('button', { name: '실패한 TC 다시 시도' }).click();
  await expect(page.getByRole('button', { name: /자동 세팅 1/ })).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('prep-calls'))).toBe('4');
  await expect(page.getByLabel('토큰 사용량')).toContainText('입력 40 · 출력 8');
});
