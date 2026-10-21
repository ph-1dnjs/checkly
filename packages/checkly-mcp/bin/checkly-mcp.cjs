#!/usr/bin/env node
// Dependency-free stdio → local HTTP adapter. stdout is reserved for MCP messages.
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function defaultConnectionFile(platform = process.platform, env = process.env, home = os.homedir()) {
  if (env.CHECKLY_MCP_CONNECTION_FILE) {
    if (!path.isAbsolute(env.CHECKLY_MCP_CONNECTION_FILE)) throw new Error('CHECKLY_MCP_CONNECTION_FILE must be absolute');
    return env.CHECKLY_MCP_CONNECTION_FILE;
  }
  const base = platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : platform === 'win32' ? (env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    : (env.XDG_CONFIG_HOME || path.join(home, '.config'));
  return path.join(base, 'checkly-mcp', 'connection.json');
}

function main(args = process.argv.slice(2)) {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write('Checkly MCP\nUsage: checkly-mcp [--connection /absolute/path/connection.json]\nRequires Node.js >=18 and an enabled MCP connection in Checkly.\n');
    return;
  }
  if (args[0] === '--version') { process.stdout.write('0.1.0\n'); return; }
  const explicit = args[0] === '--connection' ? args[1] : args[0];
  if ((args[0] === '--connection' && args.length !== 2) || (args[0] !== '--connection' && args.length > 1) || (explicit && (!path.isAbsolute(explicit) || explicit.startsWith('--')))) throw new Error('Use --connection with an absolute path.');
  const connectionFile = explicit || defaultConnectionFile();
  const MAX = 256_000;
  let active = 0;
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const failure = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
  process.stdout.on('error', () => process.exit(1));

  async function forward(line) {
    let message;
    try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); return; }
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }); return;
    }
    const hasId = Object.hasOwn(message, 'id');
    if (active >= 8) { if (hasId) failure(message.id, '요청이 많습니다. 잠시 후 다시 시도하세요.'); return; }
    active++;
    try {
      // Re-read on every request. Never cache credentials or retry a mutation after transport failure.
      const connection = JSON.parse(await readFile(connectionFile, 'utf8'));
      const url = new URL(connection.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/mcp' || url.search || url.hash || url.username || url.password || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('Invalid connection');
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${connection.token}` },
        body: line,
      });
      if (!response.ok) throw new Error('Connection unavailable');
      if (response.status === 202 || response.status === 204) return;
      const result = await response.json();
      if (hasId) send(result);
    } catch {
      if (hasId) failure(message.id, 'Checkly 앱의 API 테스트 → AI 작성 도우미 → MCP로 연결에서 연결을 켜세요. 연결이 변경되었거나 요청이 실패했습니다. 쓰기/실행 요청은 결과를 확인한 뒤 다시 요청하세요.');
    } finally { active--; }
  }

  let pending = '';
  let dropping = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (!dropping && line.trim()) {
        if (Buffer.byteLength(line) <= MAX) void forward(line);
        else failure(null, 'MCP 요청은 256KB 이하만 지원합니다.');
      }
      dropping = false;
    }
    if (Buffer.byteLength(pending) > MAX) {
      if (!dropping) failure(null, 'MCP 요청은 256KB 이하만 지원합니다.');
      dropping = true; pending = '';
    }
  });

}
module.exports = { defaultConnectionFile };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
