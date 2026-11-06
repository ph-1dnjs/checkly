import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'checkly-ai-tc-desktop-'));
  const cli = path.join(dir, 'fake-claude.cjs');
  await writeFile(cli, `#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({result: JSON.stringify({action:{type:'judge',expected:'E1',verdict:'pass',observation:'준비 완료',basis:[{k:'텍스트',v:'준비 완료'}],assertion:{type:'visibleText',text:'준비 완료'}}}),usage:{input_tokens:5,output_tokens:3,cache_read_input_tokens:0,cache_creation_input_tokens:0}})));\n`);
  await chmod(cli, 0o755);
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<h1>준비 완료</h1>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const plan = { cases: [{ key: 'qa.xlsx:TC:2', id: 'TC1', title: '준비 확인', pre: '', steps: ['화면 확인'], expected: [{ id: 'E1', text: '준비 완료 표시' }], data: [], files: [], after: [], readyRefs: [] }], startUrl: url, allowedHosts: [new URL(url).host], capture: true, video: false, imageToAi: false, tool: 'claude' as const, environmentLabel: 'local' };
  const env = { ...process.env, CHECKLY_AI_CLI_PATH: cli, CHECKLY_SUPABASE_URL: '', CHECKLY_SUPABASE_ANON_KEY: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], env });
    let page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.electronAPI?.aiTc));
    const run = await page.evaluate(p => window.electronAPI.aiTc.start(p), plan);
    await expect.poll(() => page.evaluate(() => window.electronAPI.aiTc.current()), { timeout: 30_000 }).toMatchObject({ runId: run.runId, status: 'done' });
    const approved = await page.evaluate(r => window.electronAPI.aiTc.approveAssertion({ runId: r, caseKey: 'qa.xlsx:TC:2', expectedId: 'E1', approved: true }), run.runId);
    expect(approved?.usage?.input).toBe(5);
    await app.close(); app = undefined;
    app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], env });
    page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.electronAPI?.aiTc));
    expect(await page.evaluate(() => window.electronAPI.aiTc.current())).toBeNull();
    expect(await page.evaluate(p => window.electronAPI.aiTc.savedNeeds(p), plan)).toEqual([{ key: 'qa.xlsx:TC:2', labels: [] }]);
    const replay = await page.evaluate(p => window.electronAPI.aiTc.replaySaved(p), plan);
    await expect.poll(() => page.evaluate(() => window.electronAPI.aiTc.current()), { timeout: 30_000 }).toMatchObject({ runId: replay.runId, status: 'done', budget: { modelCalls: 0 }, cases: [{ expected: [{ verdict: 'pass', by: 'automation' }] }] });
    process.stdout.write('Electron 재시작 후 저장 절차 및 IPC 재실행 통과\n');
  } finally {
    await app?.close();
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
