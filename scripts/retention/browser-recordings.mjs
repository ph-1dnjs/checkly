import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

export const RETENTION_DAYS = 30;
const BATCH_SIZE = 100;
const MAX_BATCHES = 100;
const BUCKET = 'browser-error-replays';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const validPath = new RegExp(`^(${UUID})/(${UUID})/(${UUID})\\.json\\.gz$`, 'i');

// Always check the project and clip ID before a privileged Storage deletion.
export function assertRecordingPath(row) {
  const match = typeof row.object_path === 'string' && validPath.exec(row.object_path);
  if (!match || match[1] !== row.project_id || match[3] !== row.id) {
    throw new Error(`Invalid recording object path for ${row.id}`);
  }
}

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function deleteExpired(client, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  let recordings = 0, logs = 0;
  // Re-query the oldest rows after each deletion: no offset, so no skipped records.
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = unwrap(await client.from('form_browser_recordings')
      .select('id,project_id,object_path,created_at,updated_at')
      .lt('created_at', cutoff).order('created_at').order('id').limit(BATCH_SIZE));
    if (!rows?.length) break;
    for (const row of rows) {
      assertRecordingPath(row);
      // Preserve the DB pointer if the Storage API fails. An already absent object is safe to retry.
      unwrap(await client.storage.from(BUCKET).remove([row.object_path]));
      const deleted = unwrap(await client.from('form_browser_recordings').delete()
        .eq('id', row.id).eq('project_id', row.project_id).eq('updated_at', row.updated_at)
        .lt('created_at', cutoff).select('id'));
      if (!deleted?.length) throw new Error(`Recording changed during deletion: ${row.id}`);
      recordings++;
    }
    if (rows.length < BATCH_SIZE) break;
  }
  // Logs are separate from replay files and can contain URLs. Apply the same server-side retention.
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = unwrap(await client.from('form_browser_logs').select('id').lt('created_at', cutoff)
      .order('created_at').order('id').limit(BATCH_SIZE));
    if (!rows?.length) break;
    const deleted = unwrap(await client.from('form_browser_logs').delete()
      .in('id', rows.map(row => row.id)).lt('created_at', cutoff).select('id'));
    if (deleted?.length !== rows.length) throw new Error('Some expired logs could not be deleted');
    logs += deleted.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return { recordings, logs, cutoff };
}

export async function getServiceKey(projectRef, accessToken, fetcher = fetch) {
  if (!/^[a-z0-9]{20}$/.test(projectRef) || !accessToken) throw new Error('Missing or invalid project configuration');
  const response = await fetcher(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not retrieve project API key (HTTP ${response.status})`);
  const keys = await response.json();
  const key = Array.isArray(keys) && keys.find(item => item.name === 'service_role')?.api_key;
  if (!key) throw new Error('Project service role key unavailable; check management token permissions');
  return key;
}

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const key = await getServiceKey(ref, process.env.SUPABASE_ACCESS_TOKEN);
  const client = createClient(`https://${ref}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await deleteExpired(client);
  console.log(`Retention cleanup completed: ${result.recordings} recordings, ${result.logs} logs, cutoff ${result.cutoff}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('Retention cleanup failed:', error.message); process.exitCode = 1; });
}
