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
