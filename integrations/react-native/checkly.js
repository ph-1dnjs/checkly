/* Development-only fetch inspector. No native dependencies or TLS interception. */
function installCheckly(options) {
  if (!options.enabled) return () => {};
  const root = globalThis;
  if (root.__checklyInspector) root.__checklyInspector.dispose();
  const originalFetch = root.fetch;
  const nativeFetch = originalFetch.bind(root);
  const address = options.address || 'http://127.0.0.1:4319';
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(address)) throw new Error('Checkly requires a loopback address.');
  const identity = {clientId: options.clientId, name: options.name};
  let revision = 0;
  let rules = [];
  let disposed = false;
  let syncing = null;
  const pending = new Set();

  async function transport(path, payload) {
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 700);
    try {
      const response = await nativeFetch(address + path, {
        method: 'POST', signal: controller.signal,
        headers: {'Content-Type': 'application/json', 'X-Checkly-Native': '1'},
        body: JSON.stringify({...identity, revision, ...payload}),
      });
      if (!response.ok) throw new Error('Checkly disconnected');
      return await response.json();
    } finally { clearTimeout(timer); pending.delete(controller); }
  }

  function sync() {
    if (disposed) return Promise.resolve();
    if (syncing) return syncing;
    syncing = transport('/sync', {}).then(config => {
      if (!disposed) { rules = config.rules; revision = config.revision; }
    }).catch(() => { rules = []; revision = 0; }).finally(() => { syncing = null; });
    return syncing;
  }

  function bodyValue(value) {
    if (value == null) return null;
    if (typeof value !== 'string') return '[binary or form body]';
    if (value.length > 24000) return value.slice(0, 24000) + '\n[Checkly: truncated]';
    try { return JSON.parse(value); } catch { return value; }
  }

  // Avoid URL.pathname, which is unavailable in some RN URL polyfills.
  function endpoint(value) {
    const match = /^(https?):\/\/([^/?#]+)([^?#]*)/i.exec(String(value));
    if (!match) return '';
    const scheme = match[1].toLowerCase();
    const host = match[2].toLowerCase().replace(scheme === 'https' ? /:443$/ : /:80$/, '');
    return scheme + '://' + host + (match[3].replace(/\/+$/, '') || '/');
  }

  function emit(event) {
    if (!disposed && pending.size < 8) void transport('/events', {event}).catch(() => {});
  }

  async function wrappedFetch(input, init) {
    const url = typeof input === 'string' ? input : String(input.url || input);
    if (!/^https?:\/\//i.test(url) || url.startsWith(address + '/')) return nativeFetch(input, init);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const signal = (init && init.signal) || (input && input.signal);
    const started = Date.now();
    let requestBody = bodyValue(init && init.body);
    if ((!init || init.body === undefined) && input && typeof input.clone === 'function') {
      try { requestBody = bodyValue(await input.clone().text()); } catch { /* Original request remains untouched. */ }
    }
    await sync();
    const rule = !disposed && rules.find(item => item.enabled && item.method.toUpperCase() === method && endpoint(item.match) === endpoint(url));
    try {
      if (signal && signal.aborted) {
        const error = new Error('Aborted'); error.name = 'AbortError'; throw error;
      }
      if (rule) {
        const noBody = [204, 205, 304].includes(rule.status) || method === 'HEAD';
        const response = new Response(noBody ? null : JSON.stringify(rule.body), {
          status: rule.status, headers: {'Content-Type': 'application/json', 'X-Checkly-Override': 'true'},
        });
        // RN's Response accepts a URL option inconsistently; preserve it where possible.
        try { Object.defineProperty(response, 'url', {value: url}); } catch { /* Optional metadata. */ }
        emit({url, method, status: response.status, requestBody, responseBody: noBody ? null : rule.body,
          responseContentType: 'application/json', elapsed: Date.now() - started, overridden: true});
        return response;
      }
      const response = await nativeFetch(input, init);
      const event = {url, method, status: response.status, requestBody, elapsed: Date.now() - started,
        overridden: false, responseContentType: response.headers.get('content-type') || ''};
      const contentType = event.responseContentType;
      if (/json|text\//i.test(contentType) && !/text\/event-stream/i.test(contentType)
        && Number(response.headers.get('content-length') || 0) <= 262144) {
        // Capture independently: response parsing failures never fail the app's fetch.
        try { void response.clone().text().then(text => emit({...event, responseBody: bodyValue(text)}))
          .catch(() => emit({...event, responseBody: '[body unavailable]'})); }
        catch { emit({...event, responseBody: '[body unavailable]'}); }
      } else emit({...event, responseBody: '[binary, stream, or large body omitted]'});
      return response;
    } catch (error) {
      emit({url, method, status: 0, requestBody, elapsed: Date.now() - started, overridden: false,
        error: error instanceof Error ? error.message : String(error)});
      throw error;
    }
  }

  const timer = setInterval(() => { void sync(); }, 1500);
  function dispose() {
    disposed = true;
    rules = [];
    clearInterval(timer);
    pending.forEach(controller => controller.abort());
    if (root.fetch === wrappedFetch) root.fetch = originalFetch;
    if (root.__checklyInspector && root.__checklyInspector.dispose === dispose) delete root.__checklyInspector;
  }
  root.fetch = wrappedFetch;
  root.__checklyInspector = {dispose};
  void sync();
  return dispose;
}

module.exports = {installCheckly};
