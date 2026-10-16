import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parseMarkdown } from '../../src/app/ipc/web-scenario/scenario';
import { WebScenarioStore } from '../../src/app/ipc/web-scenario/store';

// 키는 로컬 CLI 실행 결과에서만 읽고 파일이나 로그에 남기지 않는다.
function localConfig() {
  try {
    const output = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    const value = (key: string) => new RegExp(`^${key}="?([^"\\n]+)"?$`, 'm').exec(output)?.[1];
    const url = value('API_URL'), anonKey = value('ANON_KEY'), serviceKey = value('SERVICE_ROLE_KEY');
    return url && anonKey && serviceKey ? { url, anonKey, serviceKey } : null;
  } catch { return null; }
}

test('web scenarios: project RLS, atomic body/markers, authorship, update/delete conflicts', async t => {
  const config = localConfig();
  if (!config) return t.skip('로컬 Supabase가 실행되어 있지 않습니다.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(config.url, config.serviceKey, options);
  const { error: schemaError } = await admin.from('web_scenarios').select('id', { head: true });
  assert.ifError(schemaError);
  const cleanup: Array<() => Promise<unknown>> = [];
  const member = async () => {
    const code = `web-${randomUUID().slice(0, 8)}`, email = `owner.${code}@checkly.test`, password = randomUUID();
    const { data: user, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    const userId = user.user!.id;
    cleanup.push(() => admin.auth.admin.deleteUser(userId));
    const { data, error: createError } = await admin.rpc('create_project_for', { p_user: userId, p_code: code, p_nickname: 'owner' });
    assert.ifError(createError);
    const projectId: string = data[0].project_id;
    cleanup.push(async () => { await admin.from('projects').delete().eq('id', projectId); });
    const client = createClient(config.url, config.anonKey, options);
    const { error: loginError } = await client.auth.signInWithPassword({ email, password });
    assert.ifError(loginError);
    return { client, projectId, userId, store: new WebScenarioStore(client, projectId) };
  };
  try {
    const team = await member(), other = await member();
    const first = await team.store.save({ title: '로그인', markdown: '# 시나리오: 로그인\nurl: /login\nGiven `로그인` 클릭', positions: '{}' });
    assert.equal(first.createdBy, 'owner');
    assert.equal((await team.store.list()).length, 1);
    assert.deepEqual(await other.store.list(), []);
    const { data: hidden } = await other.client.from('web_scenarios').select('*').eq('id', first.id);
    assert.deepEqual(hidden, []);
    const anonymous = createClient(config.url, config.anonKey, options);
    const { data: anonymousRows } = await anonymous.from('web_scenarios').select('*');
    assert.ok(!anonymousRows?.length);
    const { error: insertDenied } = await other.client.from('web_scenarios').insert({ project_id: team.projectId, title: '침범', markdown: 'bad' });
    assert.ok(insertDenied);
    const second = await team.store.save({ id: first.id, expectedUpdatedAt: first.updatedAt, title: '수정', markdown: first.markdown + '\nThen `완료` 텍스트가 보인다', positions: '{"로그인\\n/login":[{"action":"click","target":"로그인","x":10,"y":20}]}' });
    assert.notEqual(second.updatedAt, first.updatedAt);
    assert.equal((Object.values(JSON.parse(second.positions)).flat()[0] as any).x, 10);
    assert.match(second.markdown, /완료/);
    await assert.rejects(team.store.save({ id: first.id, expectedUpdatedAt: first.updatedAt, title: '오래된 저장', markdown: 'old', positions: '{}' }), /다른 팀원/);
    await assert.rejects(team.store.remove(first.id, first.updatedAt), /다른 팀원/);
    assert.equal((await team.store.list())[0].title, '수정');
    const scenario = parseMarkdown(second.markdown)[0];
    const runId = randomUUID();
    await team.store.saveRun({ id: runId, trigger: 'editor', status: 'failed', passed: 0, failed: 1,
      startedAt: new Date().toISOString(), ranAt: new Date().toISOString(), sessionKept: true, viewport: { width: 390, height: 844 }, browser: 'chromium',
      scenarios: [scenario], results: [{ scenario, status: 'failed', failedStepIndex: 1, stepResults: [
        { stepNo: 1, status: 'skipped', elapsedMs: 12 }, { stepNo: 2, status: 'failed', elapsedMs: 45, manualVerdict: 'failed', manualReason: '표시 안 됨' },
      ] }],
    });
    assert.deepEqual(await other.store.listRuns(), []);
    const runs = await team.store.listRuns();
    assert.equal(runs[0].results[0].stepResults![0].status, 'skipped');
    assert.equal(runs[0].results[0].failedStepIndex, 1);
    const steps = await team.client.from('web_scenario_steps').select('*').eq('scenario_id', scenario.id).order('step_no');
    assert.ifError(steps.error);
    assert.equal(steps.data?.length, 2);
    await team.store.remove(second.id, second.updatedAt);
    assert.equal((await team.store.listRuns())[0].scenarios[0].title, scenario.title);
    const removed = await team.client.from('web_scenario_items').select('deleted_at').eq('id', scenario.id).single();
    assert.ok(removed.data?.deleted_at);
    assert.deepEqual(await team.store.list(), []);
  } finally {
    for (const dispose of cleanup.reverse()) await dispose();
  }
});
