/**
 * In-memory cookie store that follows browser rules (RFC 6265): Domain/host-only
 * matching, default and explicit Path, Secure and expiry. One jar lives per project
 * so scenarios, suites and Swagger calls share the same session.
 */
type StoredCookie = { name: string; value: string; domain: string; hostOnly: boolean; path: string; secure: boolean; expiresAt?: number };
export type CookieSummary = { name: string; domain: string; path: string };

const isIpAddress = (host: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

function domainMatches(host: string, domain: string): boolean {
  return host === domain || (!isIpAddress(host) && host.endsWith(`.${domain}`));
}

function defaultPath(requestPath: string): string {
  if (!requestPath.startsWith("/")) return "/";
  const last = requestPath.lastIndexOf("/");
  return last <= 0 ? "/" : requestPath.slice(0, last);
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === "/" || requestPath === cookiePath) return true;
  return requestPath.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
}

function setCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") return extended.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/) : [];
}

export class CookieJar {
  private cookies: StoredCookie[] = [];

  store(url: URL, headers: Headers, now = Date.now()): void {
    for (const raw of setCookieHeaders(headers)) this.storeOne(url, raw, now);
  }

  private storeOne(url: URL, raw: string, now: number): void {
    const [pair, ...attributes] = raw.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) return;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!/^[^=;,\s]+$/.test(name) || /[\r\n;]/.test(value)) return;
    let domain: string | undefined;
    let path: string | undefined;
    let secure = false;
    let maxAge: number | undefined;
    let expires: number | undefined;
    for (const attribute of attributes) {
      const [rawName, ...rawValue] = attribute.trim().split("=");
      const attributeName = rawName.toLowerCase();
      const attributeValue = rawValue.join("=").trim();
      if (attributeName === "domain" && attributeValue) domain = attributeValue.replace(/^\./, "").toLowerCase();
      if (attributeName === "path" && attributeValue.startsWith("/")) path = attributeValue;
      if (attributeName === "secure") secure = true;
      if (attributeName === "max-age" && /^-?\d+$/.test(attributeValue)) maxAge = Number(attributeValue);
      if (attributeName === "expires" && Number.isFinite(Date.parse(attributeValue))) expires = Date.parse(attributeValue);
    }
    const host = url.hostname.toLowerCase();
    // Reject cookies for a domain the responding host does not belong to.
    if (domain !== undefined && !domainMatches(host, domain)) return;
    const cookie: StoredCookie = {
      name, value, secure,
      domain: domain ?? host,
      hostOnly: domain === undefined,
      path: path ?? defaultPath(url.pathname || "/"),
      // Max-Age takes precedence over Expires.
      expiresAt: maxAge !== undefined ? (maxAge <= 0 ? 0 : now + maxAge * 1000) : expires,
    };
    this.cookies = this.cookies.filter(existing => !(existing.name === cookie.name && existing.domain === cookie.domain && existing.path === cookie.path));
    if (value === "" || (cookie.expiresAt !== undefined && cookie.expiresAt <= now)) return;
    this.cookies.push(cookie);
  }

  /** Cookies to send to `url`; the most specific path wins when names repeat. */
  forUrl(url: URL, now = Date.now()): Record<string, string> {
    this.purge(now);
    const host = url.hostname.toLowerCase();
    const matching = this.cookies
      .filter(cookie => (cookie.hostOnly ? host === cookie.domain : domainMatches(host, cookie.domain))
        && pathMatches(cookie.path, url.pathname || "/")
        && (!cookie.secure || url.protocol === "https:"))
      .sort((a, b) => b.path.length - a.path.length);
    const result: Record<string, string> = {};
    for (const cookie of matching) if (!Object.hasOwn(result, cookie.name)) result[cookie.name] = cookie.value;
    return result;
  }

  /** Names and scopes only; values stay in the main process. */
  list(now = Date.now()): CookieSummary[] {
    this.purge(now);
    return this.cookies.map(({ name, domain, path }) => ({ name, domain, path }));
  }

  clear(): void {
    this.cookies = [];
  }

  private purge(now: number): void {
    this.cookies = this.cookies.filter(cookie => cookie.expiresAt === undefined || cookie.expiresAt > now);
  }
}
