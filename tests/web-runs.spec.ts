import { expect, test, type Page } from '@playwright/test';
import { installAuthStub, owner, authCalls } from './fixtures/auth-stub';

const scenarioId = '6ab66302-af5e-4a11-b7f4-4bb412414dba';
const stepId = '4e86c81e-78be-401c-b5c2-9bf2264159ca';
const prepare = async (page: Page, cancelled = false) => {
  await installAuthStub(page, { enabled: true, session: owner });
  await page.addInitScript(({ scenarioId, stepId, cancelled }) => {
    localStorage.setItem('checkly:keepSessionPromptAnswer', 'skip');
    if (!sessionStorage.getItem('web-scenarios')) sessionStorage.setItem('web-scenarios', JSON.stringify([{
      id: 'document-1', title: '실행 당시 제목', markdown: `# 시나리오: 실행 당시 제목\nid: ${scenarioId}\ncode: TC_1\nurl: /login\nGiven \`로그인\` 클릭 <!-- step:${stepId} -->`,
      positions: '{}', updatedAt: '2026-10-14T00:00:00Z', createdBy: 'minsu', updatedBy: 'minsu',
    }]));
    window.electronAPI.runQa = async scenario => {
      sessionStorage.setItem('executed-snapshot', JSON.stringify(scenario));
      return { status: cancelled ? 'cancelled' : 'passed', log: ['조건 미충족'],
        stepResults: [{ stepNo: 1, status: cancelled ? 'not_run' : 'skipped', elapsedMs: 20 }] };
    };
    window.electronAPI.finishQaWorker = async () => undefined;
    window.electronAPI.mergeRunVideos = async () => null;
    window.electronAPI.setQaViewport = async () => undefined;
  }, { scenarioId, stepId, cancelled });
};
const runFromPicker = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: '시나리오 · 편집과 실행' }).click();
  await page.getByRole('tab', { name: '실행', exact: true }).click();
  await page.getByRole('button', { name: '이 시나리오만 실행' }).click();
  await expect.poll(async () => (await authCalls(page)).filter(([name]) => name === 'webScenarios.saveRun').length).toBe(1);
};

test('execution history restores after reload and reruns the saved snapshot after editing the source', async ({ page }) => {
  await prepare(page);
  await runFromPicker(page);
  const saved = (await authCalls(page)).find(([name]) => name === 'webScenarios.saveRun')![1];
  expect(saved).toMatchObject({ trigger: 'picker', status: 'passed', browser: 'chromium', sessionKept: false });
  expect(saved.results[0].stepResults[0].status).toBe('skipped');
  expect(saved.scenarios[0].url).toBe('https://dev.app.com/login');
  await page.evaluate(() => {
    const rows = JSON.parse(sessionStorage.getItem('web-scenarios')!);
    rows[0].title = '수정된 제목';
    rows[0].markdown = rows[0].markdown.replace('실행 당시 제목', '수정된 제목').replace('`로그인`', '`다른 버튼`');
    sessionStorage.setItem('web-scenarios', JSON.stringify(rows));
  });
  await page.reload();
  await page.locator('.dash-row').filter({ hasText: '실행 당시 제목' }).click();
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect.poll(async () => (await authCalls(page)).filter(([name]) => name === 'webScenarios.saveRun').length).toBe(2);
  const rerun = (await authCalls(page)).filter(([name]) => name === 'webScenarios.saveRun')[1][1];
  expect(rerun.trigger).toBe('rerun');
  expect(rerun.scenarios[0].title).toBe('실행 당시 제목');
  expect(rerun.scenarios[0].steps[0].target).toBe('로그인');
});

test('cancelled execution is saved and restored as cancelled rather than passed or failed', async ({ page }) => {
  await prepare(page, true);
  await runFromPicker(page);
  const saved = (await authCalls(page)).find(([name]) => name === 'webScenarios.saveRun')![1];
  expect(saved.status).toBe('cancelled');
  expect(saved.results[0].stepResults[0].status).toBe('not_run');
  await page.reload();
  await expect(page.locator('.dash-row')).toContainText('취소');
});

test('dashboard success rate excludes cancelled runs and duration uses completed run timestamps', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const scenario = { id: 'scenario-1', title: '통계 기록', steps: [] };
    const day = new Date(); day.setHours(9, 0, 0, 0);
    const at = (seconds: number) => new Date(day.getTime() + seconds * 1000).toISOString();
    const records = [
      { id: '1', status: 'passed', startedAt: at(0), ranAt: at(60) },
      { id: '2', status: 'failed', startedAt: at(0), ranAt: at(180) },
      { id: '3', status: 'cancelled', startedAt: at(0), ranAt: at(600) },
    ].map(record => ({ ...record, passed: record.status === 'passed' ? 1 : 0, failed: record.status === 'failed' ? 1 : 0, results: [{ scenario, elapsedSeconds: 1 }] }));
    sessionStorage.setItem('web-runs', JSON.stringify(records));
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: '웹 시나리오 통계' })).toContainText('50%');
  await expect(page.getByRole('region', { name: '웹 시나리오 통계' })).toContainText('2:00');
});

test('dashboard paginates and filters execution history', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 650 });
  await prepare(page);
  await page.addInitScript(() => {
    const scenario = { id: 'scenario-1', title: '스크롤 기록', steps: [] };
    const records = Array.from({ length: 20 }, (_, index) => ({
      id: `run-${index}`, status: 'passed', passed: 1, failed: 0,
      ranAt: new Date().toISOString(), results: [{ scenario, elapsedSeconds: 1 }],
    }));
    sessionStorage.setItem('web-runs', JSON.stringify(records));
  });
  await page.goto('/');
  await expect(page.locator('.dash-row')).toHaveCount(10);
  await expect(page.locator('.dash-pager')).toContainText('총 20건');
  await page.getByRole('button', { name: '다음 페이지' }).click();
  await expect(page.locator('.dash-pager')).toContainText('2 / 2');
  await page.getByLabel('실행명 검색').fill('없음');
  await expect(page.getByText('조건에 맞는 실행이 없어요')).toBeVisible();
});

test('dashboard separates web and API counts and filters API runs by status and environment', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    sessionStorage.setItem('api-runs', JSON.stringify([
      { id: 'api-1', type: 'api', name: '주문 조회', status: 'passed', environmentId: 'v-dev', startedAt: now, endedAt: now },
      { id: 'api-2', type: 'api', name: '상품 생성', status: 'blocked', environmentId: 'v-stg', startedAt: now, endedAt: now },
    ]));
  });
  await page.goto('/');
  const api = page.getByRole('region', { name: 'API 테스트 통계' });
  await expect(api).toContainText('100%');
  await expect(api).toContainText('설정 필요');
  await page.getByRole('tab', { name: 'API 테스트' }).click();
  await page.getByLabel('환경', { exact: true }).selectOption('v-stg');
  await expect(page.locator('.dash-row')).toHaveCount(1);
  await expect(page.locator('.dash-row')).toContainText('상품 생성');
  await page.locator('.dash-row').click();
  await expect(page.getByRole('dialog', { name: 'API 실행 상세' })).toContainText('설정 필요');
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByLabel('상태', { exact: true }).selectOption('failed');
  await expect(page.getByText('조건에 맞는 실행이 없어요')).toBeVisible();
});

test('dashboard opens an uploaded browser error recording in the server scope', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const now = Date.now();
    const session = { id: 'record-1', title: '로그인 오류 기록', url: 'https://example.test', source: 'browser', startedAt: now, status: 'saved', eventCount: 0, bytes: 0, trigger: { type: 'page-error', at: now, url: 'https://example.test' } };
    Object.assign(window.electronAPI, {
      liveSession: {
        list: async () => ({ sessions: [session], mode: 'team', uploadableIds: [] }),
        read: async (id: string, scope: string) => { sessionStorage.setItem('dashboard-recording-read', JSON.stringify([id, scope])); return { session, documents: [] }; },
        onChanged: () => () => {},
      },
      loadFormAutomationState: async () => ({ version: 1, values: {} }),
      setFormAutomationState: async () => undefined,
      readFormAutomationSessionEvents: async () => [],
      saveFormAutomationSessionEvent: async () => true,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /오류 기록.*로그인 오류 기록/ }).click();
  await expect(page.getByRole('dialog', { name: '브라우저 기록' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('dashboard-recording-read'))).toBe(JSON.stringify(['record-1', 'team']));
  await expect(page.getByRole('button', { name: '서버', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
