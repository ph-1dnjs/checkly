import { expect, test } from '@playwright/test';
import { installAuthStub } from './fixtures/auth-stub';

test('준비 화면에서 이미지 전송과 저장 절차 실행 설정을 전달한다', async ({ page }) => {
  await installAuthStub(page, { enabled: false });
  await page.addInitScript(() => {
    const workbook = { fileName: 'qa.xlsx', sheets: [{ name: 'TC', hidden: false, headerRow: 1, headers: [{ col: 1, label: 'TC ID' }, { col: 2, label: '테스트 단계' }, { col: 3, label: '기대 결과' }], mapping: { id: 1, steps: 2, expected: 3 }, rows: [{ row: 2, hidden: false, cells: { 1: 'TC-1', 2: '검색', 3: '결과 표시' }, mergedFrom: [], formulaWithoutValue: [] }] }] };
    const api = {
      current: async () => null, tools: async () => [{ tool: 'codex', version: 'test' }],
      onState: () => () => {}, onPreview: () => () => {}, onPrepareUsage: () => () => {},
      importWorkbook: async () => ({ workbook }),
      prepare: async ({ cases }: { cases: Array<{ key: string }> }) => { sessionStorage.setItem('ai-tc-prepared', 'called'); return cases.map(item => ({ key: item.key, data: [], files: [], note: '' })); },
      savedNeeds: async ({ cases }: { cases: Array<{ key: string }> }) => cases.map(item => ({ key: item.key, labels: ['검색어'] })),
      replaySaved: async (plan: unknown, assisted: boolean) => { sessionStorage.setItem('ai-tc-replay', JSON.stringify({ plan, assisted })); throw new Error('검증용 중단'); },
    };
    Object.assign(window.electronAPI, { aiTc: api });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI TC 실행' }).click();
  await page.getByRole('switch', { name: /AI 데이터 자동 준비/ }).click();
  await page.getByRole('button', { name: '엑셀 파일 선택' }).click();
  await page.getByRole('button', { name: 'AI TC 준비' }).click();
  await page.getByPlaceholder('https://qa.example.com').fill('https://qa.example.com');
  await page.getByRole('button', { name: '저장된 절차의 데이터 항목 불러오기' }).click();
  await page.getByRole('textbox', { name: '검색어 값' }).fill('체크');
  await page.getByRole('button', { name: '저장된 절차의 데이터 항목 불러오기' }).click();
  await expect(page.getByRole('textbox', { name: '검색어 값' })).toHaveValue('체크');
  await page.getByText('AI 전송', { exact: true }).click();
  await expect(page.getByRole('switch', { name: /화면 이미지 AI 전송/ })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: /화면 이미지 AI 전송/ }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '저장된 절차로 빠른 실행' }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ai-tc-replay'))).not.toBeNull();
  const call = JSON.parse((await page.evaluate(() => sessionStorage.getItem('ai-tc-replay'))) ?? '{}');
  expect(call.assisted).toBe(false);
  expect(call.plan.imageToAi).toBe(true);
  expect(call.plan.startUrl).toBe('https://qa.example.com');
  expect(call.plan.cases[0].data).toEqual([{ label: '검색어', value: '체크' }]);
  expect(await page.evaluate(() => sessionStorage.getItem('ai-tc-prepared'))).toBeNull();
});

test('결과에서 준비 세션 누계와 실행 토큰을 구분한다', async ({ page }) => {
  await installAuthStub(page, { enabled: false });
  await page.addInitScript(() => {
    const result = { runId: 'run1', status: 'done', current: 0, url: 'https://qa.example.com', outOfDomain: false, capturePaused: false, provider: 'Claude CLI', allowedHosts: ['qa.example.com'], viewport: { width: 1440, height: 900 }, capture: false, video: false, startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:01Z', budget: { actions: 1, modelCalls: 1, maxActions: 40, maxModelCalls: 300, maxMinutes: 10 }, usage: { input: 5, output: 3, cachedInput: 1, cacheWrite: 2, measured: 1, unknown: 0 }, preparationUsage: { claude: { input: 12, output: 4, cached: 0, write: 0, unknown: 1 }, codex: { input: 0, output: 0, cached: 0, write: 0, unknown: 0 } }, cases: [{ key: 'qa:TC:2', id: 'TC1', title: '확인', sheet: 'TC', row: 2, actions: [], expected: [{ id: 'E1', text: '결과', verdict: 'pass', observation: '확인', basis: [], by: 'ai' }] }] };
    Object.assign(window.electronAPI, { aiTc: { current: async () => result, tools: async () => [], onState: () => () => {}, onPreview: () => () => {}, onPrepareUsage: () => () => {} } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI TC 실행' }).click();
  await page.getByRole('tab', { name: /결과/ }).click();
  await expect(page.getByText(/준비 \(claude\) 입력 12/)).toContainText('미확인 1회');
  await expect(page.getByText(/실행 토큰 입력 5/)).toContainText('출력 3');
});
