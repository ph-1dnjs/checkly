import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRecordingPath, deleteExpired, getServiceKey } from '../../scripts/retention/browser-recordings.mjs';

const row = { id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002', object_path: '00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000001.json.gz', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

test('validates object ownership before deleting from Storage', () => {
  assert.doesNotThrow(() => assertRecordingPath(row));
  assert.throws(() => assertRecordingPath({ ...row, object_path: row.object_path.replace(row.project_id, '00000000-0000-4000-8000-000000000004') }));
});

test('retains database pointer when Storage deletion fails', async () => {
  let rowDeleted = false;
  const chain: any = { select: () => chain, lt: () => chain, order: () => chain, limit: async () => ({ data: [row], error: null }), delete: () => { rowDeleted = true; return chain; } };
  const client: any = { from: () => chain, storage: { from: () => ({ remove: async () => ({ error: new Error('storage unavailable') }) }) } };
  await assert.rejects(deleteExpired(client, new Date('2026-02-01T00:00:00Z')), /storage unavailable/);
  assert.equal(rowDeleted, false);
});

test('uses cutoff and deletes storage before metadata and logs', async () => {
  const actions: string[] = [];
  const client: any = { storage: { from: () => ({ remove: async () => { actions.push('storage'); return { data: [], error: null }; } }) }, from: (table: string) => {
    let deleting = false;
    const chain: any = { select: () => deleting ? Promise.resolve({ data: [{ id: table === 'form_browser_logs' ? 'log' : row.id }] }) : chain,
      lt: (_col: string, value: string) => { assert.equal(value, '2026-01-02T00:00:00.000Z'); return chain; },
      order: () => chain, limit: async () => ({ data: table === 'form_browser_logs' ? [{ id: 'log' }] : [row] }),
      delete: () => { deleting = true; actions.push(table); return chain; }, eq: () => chain, in: () => chain };
    return chain;
  } };
  const result = await deleteExpired(client, new Date('2026-02-01T00:00:00Z'));
  assert.deepEqual(actions, ['storage', 'form_browser_recordings', 'form_browser_logs']);
  assert.equal(result.recordings, 1); assert.equal(result.logs, 1);
});

test('does not disclose management API failures or keys', async () => {
  await assert.rejects(getServiceKey('abcdefghijklmnopqrst', 'token', async () => new Response('secret response', { status: 403 })), /HTTP 403/);
});
