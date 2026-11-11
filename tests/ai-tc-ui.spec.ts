import { expect, test } from '@playwright/test';
import { installAuthStub } from './fixtures/auth-stub';

test('제어 인계 요청과 답장을 순서대로 유지한다', async ({ page }) => {
  await installAuthStub(page, { enabled: false });
  await page.addInitScript(() => {
    const state = { runId: 'chat-run', status: 'waiting', current: 0, wait: { kind: 'handoff', title: '사용자 확인', body: '첫 번째 요청' }, url: 'https://qa.example.com', outOfDomain: false, capturePaused: false, provider: 'Codex CLI', allowedHosts: ['qa.example.com'], viewport: { width: 1440, height: 900 }, startedAt: '2026-01-01T00:00:00Z', budget: { actions: 0, modelCalls: 0 }, cases: [{ key: '1', id: 'TC1', title: '확인', sheet: 'TC', row: 2, actions: [], expected: [] }] };
    let listener = (_state: unknown) => {};
    Object.assign(window.electronAPI, { aiTc: { current: async () => state, tools: async () => [], onState: (fn: typeof listener) => { listener = fn; return () => {}; }, onPreview: () => () => {}, onPrepareUsage: () => () => {}, decide: async () => { listener({ ...state, status: 'running', wait: undefined }); setTimeout(() => listener({ ...state, wait: { ...state.wait, body: '두 번째 요청' } }), 100); } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI TC 실행' }).click();
  await page.getByRole('listitem', { name: '실행(으)로 이동' }).click();
  const chat = page.locator('.aitcx-chat-scroll');
  await expect(chat.getByText('중단 사유: 첫 번째 요청')).toBeVisible();
  await page.getByRole('textbox', { name: '메시지 입력' }).fill('첫 번째 답변');
  await page.getByRole('textbox', { name: '메시지 입력' }).press('Enter');
  await expect(chat.getByText('중단 사유: 두 번째 요청')).toBeVisible();
  await expect(chat).toContainText(/첫 번째 요청[\s\S]*첫 번째 답변[\s\S]*두 번째 요청/);
  await expect(chat.getByRole('button', { name: /직접 제어하기/ })).toHaveCount(1);
});

test('자동 준비를 끄고 데이터 입력 후 저장 절차를 AI 준비 호출 없이 실행한다', async ({ page }) => {
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
  await page.getByRole('button', { name: '엑셀 파일 선택' }).first().click();
  await page.getByRole('button', { name: /준비로 이동/ }).click();
  await page.getByRole('button', { name: '시작 URL' }).click();
  await page.getByPlaceholder('https://qa.example.com').fill('https://qa.example.com');
  await page.getByRole('button', { name: '저장된 절차의 데이터 항목 불러오기' }).click();
  await page.getByRole('button', { name: /직접 입력/ }).click();
  await page.getByRole('textbox', { name: '검색어 값' }).fill('체크');
  await page.getByRole('button', { name: '저장된 절차의 데이터 항목 불러오기' }).click();
  await expect(page.getByRole('textbox', { name: '검색어 값' })).toHaveValue('체크');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '저장된 절차로 빠른 실행' }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ai-tc-replay'))).not.toBeNull();
  const call = JSON.parse((await page.evaluate(() => sessionStorage.getItem('ai-tc-replay'))) ?? '{}');
  expect(call.assisted).toBe(false);
  expect(call.plan.imageToAi).toBe(false);
  expect(call.plan.startUrl).toBe('https://qa.example.com');
  expect(call.plan.cases[0].data).toEqual([{ label: '검색어', value: '체크' }]);
  expect(await page.evaluate(() => sessionStorage.getItem('ai-tc-prepared'))).toBeNull();
});

test('결과에서 준비 세션 누계와 실행 토큰을 구분한다', async ({ page }) => {
  await installAuthStub(page, { enabled: false });
  await page.addInitScript(() => {
    const result = { runId: 'run1', status: 'done', current: 0, url: 'https://qa.example.com', outOfDomain: false, capturePaused: false, provider: 'Claude CLI', allowedHosts: ['qa.example.com'], viewport: { width: 1440, height: 900 }, capture: false, video: false, startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:01Z', budget: { actions: 1, modelCalls: 1, maxActions: 40, maxModelCalls: 300, maxMinutes: 10 }, usage: { input: 5, output: 3, cachedInput: 1, cacheWrite: 2, measured: 1, unknown: 0 }, preparationUsage: { claude: { input: 12, output: 4, cached: 0, write: 0, unknown: 1 }, codex: { input: 0, output: 0, cached: 0, write: 0, unknown: 0 } }, cases: [{ key: 'qa:TC:2', id: 'TC1', title: '확인', sheet: 'TC', row: 2, actions: [], expected: [{ id: 'E1', text: '결과', verdict: 'pass', observation: '확인', basis: [], by: 'ai' }] }] };
    Object.assign(result.cases[0]!, { recording: [{ type: 'verify', expected: 'E1', candidate: { type: 'visibleText', text: '완료' }, approved: false }], modelCalls: [{ phase: 'retry', attempt: 1, promptChars: 1000, snapshotChars: 100, image: false, outcome: 'error', reason: 'format', usage: { input: 5, output: 3, cachedInput: 1, cacheWrite: 2 } }] });
    Object.assign(window.electronAPI, { aiTc: { current: async () => result, tools: async () => [], onState: () => () => {}, onPreview: () => () => {}, onPrepareUsage: () => () => {}, approveAssertion: async (input: unknown) => { sessionStorage.setItem('approval', JSON.stringify(input)); return result; }, replay: async (_id: string, assisted: boolean) => { sessionStorage.setItem('replay', String(assisted)); throw new Error('검증용 중단'); } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI TC 실행' }).click();
  await page.getByRole('listitem', { name: '결과(으)로 이동' }).click();
  await expect(page.getByText(/준비 \(claude, 화면 세션 누계\) 입력 12/)).toContainText('미확인 1회');
  await expect(page.getByText(/실행 토큰 입력 5/)).toContainText('출력 3');
  await page.getByRole('button', { name: /통과 · E1/ }).click();
  await expect(page.getByText(/프롬프트 1,000자.*응답 형식 오류/)).toBeVisible();
  await page.getByRole('button', { name: '검증 조건 승인' }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('approval'))).toContain('"approved":true');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '빠른 재실행', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('replay'))).toBe('false');
});
