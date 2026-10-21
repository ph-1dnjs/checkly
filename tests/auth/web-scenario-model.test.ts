import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument, isUuid } from '../../src/app/ipc/web-scenario/normalize';
import { parseMarkdown } from '../../src/app/ipc/web-scenario/scenario';
import { stepOutcomes } from '../../src/renderer/shared/report/run-report';

const markdown = '# 시나리오: 로그인\nurl: /login\nGiven `로그인` 클릭\nAnd `로그인` 클릭';
const current = markdown.replace('url: /login', 'endpoint: 2f1c3c9e-6a55-4d8f-9d6a-1b2c3d4e5f60');

test('legacy url line becomes a goto step and endpoint id is kept in the body', () => {
  const migrated = normalizeDocument(markdown, '{}');
  assert.doesNotMatch(migrated.markdown, /^url:/m);
  assert.deepEqual(migrated.scenarios[0].steps.map(step => [step.action, step.target]), [['goto', '/login'], ['click', '로그인'], ['click', '로그인']]);
  assert.equal(migrated.scenarios[0].url, '');
  const root = normalizeDocument('# 시나리오: 홈\nurl: /\nGiven `로그인` 클릭', '{}');
  assert.deepEqual(root.scenarios[0].steps.map(step => step.action), ['click']);
  const linked = normalizeDocument(current, '{}');
  assert.match(linked.markdown, /^endpoint: 2f1c3c9e-6a55-4d8f-9d6a-1b2c3d4e5f60$/m);
  assert.equal(linked.scenarios[0].endpointId, '2f1c3c9e-6a55-4d8f-9d6a-1b2c3d4e5f60');
  assert.equal(linked.scenarios[0].steps.length, 2);
});
test('legacy repeated markers receive distinct UUIDs and retain their coordinates', () => {
  const first = normalizeDocument(markdown, JSON.stringify({ '로그인\n/login': [
    { action: 'click', target: '로그인', x: 12.3, y: 24 }, { action: 'click', target: '로그인', x: 65, y: 72 },
  ] }));
  const other = normalizeDocument(markdown, '{}');
  const scenario = first.scenarios[0];
  assert.ok(isUuid(scenario.id));
  assert.notEqual(scenario.id, other.scenarios[0].id);
  assert.notEqual(scenario.steps[1].databaseId, scenario.steps[2].databaseId);
  assert.deepEqual(scenario.steps.map(step => step.x), [undefined, 12.3, 65]);
  assert.equal(scenario.steps[1].markerViewport, 'desktop');
  assert.equal(scenario.steps[1].markerPageUrl, '/login');
  const saved = normalizeDocument(first.markdown, first.positions);
  assert.deepEqual(saved, first);
  assert.equal(parseMarkdown(first.markdown)[0].steps[1].target, '로그인');
});

test('editing title, target and reordering steps retains markers by UUID', () => {
  const first = normalizeDocument(markdown, JSON.stringify({ '로그인\n/login': [
    { action: 'click', target: '로그인', x: 10, y: 20, markerViewport: 'mobile', markerPageUrl: 'https://example.com/login' },
    { action: 'click', target: '로그인', x: 70, y: 80 },
  ] }));
  const lines = first.markdown.replace('시나리오: 로그인', '시나리오: 수정').split('\n');
  const clicks = (line: string) => /^(Given|And) `로그인`/.test(line);
  const actions = lines.filter(clicks).reverse().map(line => line.replace('`로그인`', '`새 버튼`'));
  const edited = lines.filter(line => !clicks(line)).concat(actions).join('\n');
  const changed = normalizeDocument(edited, first.positions).scenarios[0];
  assert.equal(changed.id, first.scenarios[0].id);
  assert.deepEqual(changed.steps.map(step => step.x), [undefined, 70, 10]);
  assert.equal(changed.steps[2].markerViewport, 'mobile');
  assert.equal(changed.steps[2].markerPageUrl, 'https://example.com/login');
});

test('reports use recorded skipped and not_run outcomes instead of guessing', () => {
  const scenario = normalizeDocument(current, '{}').scenarios[0];
  assert.deepEqual(stepOutcomes({ scenario, status: 'passed', stepResults: [
    { stepNo: 1, status: 'skipped', elapsedMs: 25 }, { stepNo: 2, status: 'passed', elapsedMs: 40 },
  ] }), ['skipped', 'passed']);
  assert.deepEqual(stepOutcomes({ scenario, status: 'cancelled', stepResults: [
    { stepNo: 1, status: 'passed', elapsedMs: 20 }, { stepNo: 2, status: 'not_run', elapsedMs: 0 },
  ] }), ['passed', 'not_run']);
});

test('all actions retain wait_seconds when parsed with step identity metadata', () => {
  const steps = parseMarkdown(`# 시나리오: 대기
url: /
Given \`/next\` 페이지로 이동한다 [대기 2초]
And \`인증번호\` 수동 입력 [안내] [대기 3초]
And \`화면\` 브라우저 직접 제어 [대기 4초]
And \`화면\` 수동 결과 확인 [대기 5초]
And \`첨부\`에 \`file.txt\` 파일 업로드 [대기 6초]`)[0].steps;
  assert.deepEqual(steps.map(step => step.waitSeconds), [2, 3, 4, 5, 6]);
});

test('team run storage keeps complete step fields and separates local upload paths', async () => {
  const { WebScenarioStore } = await import('../../src/app/ipc/web-scenario/store');
  const calls: unknown[] = [];
  const client = { rpc: async (_name: string, payload: unknown) => { calls.push(payload); return { error: null }; } };
  const scenario = normalizeDocument('# 시나리오: 업로드\nurl: /\nGiven `첨부`에 `/private/file.pdf` 파일 업로드\nAnd `인증` 수동 입력', '{}').scenarios[0];
  const record = { id: crypto.randomUUID(), trigger: 'editor' as const, status: 'passed' as const, passed: 1, failed: 0,
    startedAt: new Date().toISOString(), ranAt: new Date().toISOString(), sessionKept: false, viewport: { width: 390, height: 844 }, browser: 'chromium',
    scenarios: [scenario], results: [{ scenario, status: 'passed' as const, stepResults: scenario.steps.map((_, index) => ({ stepNo: index + 1, status: 'passed' as const, elapsedMs: 10 })) }],
  };
  const store = new WebScenarioStore(client as any, crypto.randomUUID());
  await store.saveRun(record);
  assert.equal((calls[0] as any).p.results[0].scenario.steps[0].value, '');
  assert.equal((calls[0] as any).p.results[0].scenario.steps[1].required, true);
  assert.equal(record.scenarios[0].steps[0].value, '/private/file.pdf');
  await assert.rejects(store.saveRun({ ...record, trigger: 'invalid' as any }), /실행 기록/);
  assert.equal(calls.length, 1);
});

test('copying a saved document into a new document renews scenario and step UUIDs', () => {
  const first = normalizeDocument(markdown, JSON.stringify({ '로그인\n/login': [{ action: 'click', target: '로그인', x: 10, y: 20 }] }));
  const copy = normalizeDocument(first.markdown, first.positions, true);
  assert.notEqual(copy.scenarios[0].id, first.scenarios[0].id);
  assert.notEqual(copy.scenarios[0].steps[1].databaseId, first.scenarios[0].steps[1].databaseId);
  assert.equal(copy.scenarios[0].steps[1].x, 10);
});

test('saved navigation removes hosts and retains query, hash and stable step identity', () => {
  const saved = normalizeDocument('# 시나리오: 경로\nurl: https://old.example/login?next=1#form\nGiven `https://old.example/orders?q=2#list` 페이지로 이동한다', '{}');
  assert.doesNotMatch(saved.markdown, /https:\/\/old.example/);
  assert.deepEqual(saved.scenarios[0].steps.map(step => step.target), ['/login?next=1#form', '/orders?q=2#list']);
  assert.deepEqual(normalizeDocument(saved.markdown, saved.positions), saved);
});

test('selected environment overrides legacy absolute navigation addresses', async () => {
  const { resolveScenarioUrl } = await import('../../src/app/ipc/web-scenario/scenario');
  const scenario = parseMarkdown('# 시나리오: 경로\nurl: https://old.example/login\nGiven `//old.example/orders?q=2#list` 페이지로 이동한다')[0];
  const resolved = resolveScenarioUrl(scenario, 'https://staging.example/app/');
  assert.equal(resolved.url, 'https://staging.example/login');
  assert.equal(new URL(resolved.steps[0].target, resolved.url).href, 'https://staging.example/orders?q=2#list');
  assert.equal(scenario.url, 'https://old.example/login');
  assert.equal(resolveScenarioUrl({ ...scenario, url: '' }, 'https://staging.example/app/').url, 'https://staging.example/app/');
  assert.throws(() => resolveScenarioUrl(scenario, 'file:///tmp/test'));
});
