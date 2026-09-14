import { contextBridge, ipcRenderer, webFrame } from "electron";

contextBridge.exposeInMainWorld("__CHECKLY_FORM_AUTOMATION__", {
  emitNetwork: (payload: unknown) =>
    ipcRenderer.sendToHost("form-automation:network-event", payload),
});

const endpointMatches = (requestUrl: string, ruleMatch: string, baseUrl = "https://qa.local") => {
  const match = String(ruleMatch || "").trim();
  if (!match) return false;
  const normalizePath = (value: string) => value.replace(/\/+$/, "") || "/";
  try {
    const request = new URL(String(requestUrl), baseUrl);
    const absoluteRule = /^https?:\/\//i.test(match);
    const rule = new URL(match, absoluteRule ? undefined : request.origin);
    if (absoluteRule && request.origin !== rule.origin) return false;
    return normalizePath(request.pathname) === normalizePath(rule.pathname);
  } catch {
    return String(requestUrl) === match;
  }
};

const hookSource = `(() => {
  if (window.__CHECKLY_FORM_HOOKED__) return;
  window.__CHECKLY_FORM_HOOKED__ = true;
  let config = { overrides: [] };
  const nativeFetch = window.fetch.bind(window);
  const NativeXHR = window.XMLHttpRequest;
  const emit = (payload) => {
    try {
      window.__CHECKLY_FORM_AUTOMATION__?.emitNetwork({
        pageUrl: location.href,
        ...payload,
        at: new Date().toISOString(),
      });
    } catch {}
  };
  const printable = (value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) {
      const source = event.target.src || event.target.href || event.target.currentSrc || '';
      emit({
        type: 'resource-error', category: 'page', url: source || location.href,
        method: 'RESOURCE', status: 0, error: '리소스를 불러오지 못했습니다.',
        element: event.target.tagName || '',
      });
      return;
    }
    emit({
      type: 'page-error', category: 'page', url: location.href, method: 'JS', status: 0,
      error: event.message || '페이지 스크립트 오류', source: event.filename || '',
      line: event.lineno || 0, column: event.colno || 0, stack: event.error?.stack || '',
    });
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    emit({
      type: 'unhandled-rejection', category: 'page', url: location.href,
      method: 'PROMISE', status: 0,
      error: printable(event.reason) || '처리되지 않은 Promise 오류',
    });
  });
  const nativeConsoleError = console.error.bind(console);
  console.error = (...args) => {
    emit({
      type: 'console-error', category: 'page', url: location.href,
      method: 'CONSOLE', status: 0,
      error: args.map(printable).join(' ').slice(0, 5000),
    });
    return nativeConsoleError(...args);
  };
  const bodyValue = (value) => {
    if (value == null) return null;
    if (typeof value === 'string') { try { return JSON.parse(value); } catch { return value; } }
    if (value instanceof URLSearchParams) return Object.fromEntries(value.entries());
    if (value instanceof FormData) return Object.fromEntries(value.entries());
    return '[binary body]';
  };
  const endpointMatches = ${endpointMatches.toString()};
  const findOverride = (url, method) => config.overrides.find((rule) => (
    rule.enabled
    && (!rule.method || String(rule.method).toUpperCase() === method)
    && endpointMatches(url, rule.match, location.href)
  ));

  window.addEventListener('__checkly_form_config__', (event) => {
    config = { ...config, ...event.detail };
  });

  window.fetch = async (...args) => {
    const request = args[0] instanceof Request ? args[0] : null;
    const options = args[1] || {};
    const url = String(request?.url || args[0]);
    const method = String(options.method || request?.method || 'GET').toUpperCase();
    const started = performance.now();
    const override = findOverride(url, method);
    if (override) {
      const response = new Response(JSON.stringify(override.body), {
        status: override.status || 200,
        headers: { 'Content-Type': 'application/json', 'X-Checkly-Override': 'true' },
      });
      emit({ type: 'fetch', url, method, requestBody: bodyValue(options.body), status: response.status, responseBody: override.body, elapsed: Math.round(performance.now() - started), overridden: true });
      return response;
    }
    try {
      const response = await nativeFetch(...args);
      const clone = response.clone();
      let responseBody = await clone.text();
      try { responseBody = responseBody ? JSON.parse(responseBody) : null; } catch {}
      emit({ type: 'fetch', url, method, requestBody: bodyValue(options.body), status: response.status, responseBody, elapsed: Math.round(performance.now() - started), overridden: false });
      return response;
    } catch (error) {
      emit({ type: 'fetch', url, method, requestBody: bodyValue(options.body), status: 0, error: error?.message || String(error), elapsed: Math.round(performance.now() - started), overridden: false });
      throw error;
    }
  };

  class ChecklyProxyXHR extends EventTarget {
    constructor() {
      super();
      this.readyState = 0; this.status = 0; this.statusText = ''; this.response = null; this.responseText = '';
      this.responseType = ''; this.responseURL = ''; this.timeout = 0; this.withCredentials = false; this.upload = new EventTarget();
      this.onreadystatechange = null; this.onload = null; this.onloadend = null; this.onerror = null; this.onabort = null; this.ontimeout = null; this.onprogress = null;
      this._native = null; this._headers = {};
    }
    _fire(type) {
      const event = new Event(type);
      this.dispatchEvent(event);
      const handler = this['on' + type];
      if (typeof handler === 'function') handler.call(this, event);
    }
    open(method, url, async = true, user, password) {
      this._method = String(method).toUpperCase(); this._url = String(url); this._async = async;
      this._override = findOverride(this._url, this._method);
      if (this._override) { this.readyState = 1; this._fire('readystatechange'); return; }
      this._native = new NativeXHR();
      ['readystatechange', 'load', 'loadend', 'error', 'abort', 'timeout', 'progress'].forEach((type) => this._native.addEventListener(type, () => {
        this.readyState = this._native.readyState; this.status = this._native.status; this.statusText = this._native.statusText;
        this.response = this._native.response;
        this.responseText = this._native.responseType && this._native.responseType !== 'text' ? '' : this._native.responseText;
        this.responseURL = this._native.responseURL;
        if (type === 'loadend') {
          let responseBody = this.responseText;
          try { responseBody = responseBody ? JSON.parse(responseBody) : this.response; } catch {}
          emit({ type: 'xhr', url: this._url, method: this._method, requestBody: this._requestBody, status: this.status, responseBody, elapsed: Math.round(performance.now() - this._started), overridden: false });
        }
        this._fire(type);
      }));
      this._native.open(method, url, async, user, password);
    }
    setRequestHeader(name, value) { if (this._native) this._native.setRequestHeader(name, value); else this._headers[name] = value; }
    getResponseHeader(name) { return this._override ? (name.toLowerCase() === 'content-type' ? 'application/json' : null) : this._native?.getResponseHeader(name); }
    getAllResponseHeaders() { return this._override ? 'content-type: application/json\\r\\nx-checkly-override: true\\r\\n' : this._native?.getAllResponseHeaders() || ''; }
    overrideMimeType(value) { this._native?.overrideMimeType(value); }
    abort() { if (this._native) this._native.abort(); else { this.readyState = 0; this._fire('abort'); this._fire('loadend'); } }
    send(body) {
      this._requestBody = bodyValue(body); this._started = performance.now();
      if (!this._override) {
        this._native.responseType = this.responseType;
        this._native.timeout = this.timeout;
        this._native.withCredentials = this.withCredentials;
        return this._native.send(body);
      }
      setTimeout(() => {
        const json = JSON.stringify(this._override.body);
        this.readyState = 4; this.status = this._override.status || 200;
        this.statusText = this.status >= 400 ? 'Checkly Override Error' : 'OK';
        this.responseURL = new URL(this._url, location.href).href;
        this.responseText = json;
        this.response = this.responseType === 'json' ? this._override.body : json;
        this._fire('readystatechange'); this._fire('load'); this._fire('loadend');
        emit({ type: 'xhr', url: this._url, method: this._method, requestBody: this._requestBody, status: this.status, responseBody: this._override.body, elapsed: Math.round(performance.now() - this._started), overridden: true });
      }, 0);
    }
  }
  ChecklyProxyXHR.UNSENT = 0; ChecklyProxyXHR.OPENED = 1; ChecklyProxyXHR.HEADERS_RECEIVED = 2; ChecklyProxyXHR.LOADING = 3; ChecklyProxyXHR.DONE = 4;
  window.XMLHttpRequest = ChecklyProxyXHR;
})();`;

const installHook = () => {
  void webFrame.executeJavaScript(hookSource).catch(() => undefined);
};

// Electron 버전에 따라 preload 실행 시점에 loaded 이벤트가 이미 지난 경우가 있어
// 즉시 설치하고, 아직 이벤트 전이라면 한 번 더 안전하게 시도한다.
installHook();
process.once("loaded", installHook);
