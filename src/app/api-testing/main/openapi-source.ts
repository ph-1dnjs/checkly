const HTML_ERROR = "명세 대신 웹 페이지(HTML)를 받았습니다. Swagger 화면 주소가 아니라 /v3/api-docs 같은 JSON·YAML 명세 주소를 넣으세요";
const isSpec = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object"
  && "openapi" in value && "paths" in value);

/** Read static Swagger configuration as data. Never evaluate downloaded scripts. */
const embeddedSpec = (text: string): string | undefined => {
  const pattern = /["']?(?:swaggerDoc|spec)["']?\s*:\s*\{/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[0].length - 1;
    let depth = 0, quoted = false, escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        const json = text.slice(start, index + 1);
        try { const document: unknown = JSON.parse(json); if (isSpec(document)) return JSON.stringify(document); } catch { /* Not a JSON object. */ }
        break;
      }
    }
  }
};

/** Accept a direct JSON/YAML URL or the same-origin document behind Swagger UI. */
export async function fetchOpenApiSource(url: string, headers: Record<string, string> = {}, request: typeof fetch = fetch): Promise<string> {
  const origin = new URL(url).origin;
  const read = async (target: string, initializer = false): Promise<string> => {
    let response: Response;
    try { response = await request(target, { headers, signal: AbortSignal.timeout(30_000), redirect: "error" }); }
    catch { throw new Error("명세 URL에 연결할 수 없습니다. Swagger 또는 JSON·YAML 명세 주소를 확인하세요"); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error([401, 403].includes(response.status) ? `명세 인증 실패: HTTP ${response.status}. 문서용 아이디·비밀번호와 접근 권한을 확인하세요`
        : `명세 가져오기 실패: HTTP ${response.status}${response.status === 404 ? ". 명세 주소를 확인하세요" : ""}`);
    }
    if (!response.body) throw new Error("명세 응답이 비어 있습니다");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        // Pretty-printed embedded specs make Swagger's wrapper much larger than its JSON.
        // The extracted document still goes through readOpenApi's original 5 MB limit.
        if (size > (initializer ? 15_000_000 : 5_000_000))
          throw new Error(initializer ? "Swagger 초기화 파일은 15MB 이하만 지원합니다" : "명세는 5MB 이하만 지원합니다");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    return Buffer.concat(chunks).toString("utf8");
  };
  const first = await read(url);
  if (!/^\s*</.test(first)) return first;
  if (!/swagger-ui|SwaggerUIBundle/i.test(first)) throw new Error(HTML_ERROR);
  const queue = [{ url, text: first }];
  const visited = new Set([url]);
  let failure: unknown;
  for (let index = 0; index < queue.length && visited.size <= 8; index += 1) {
    const item = queue[index];
    const embedded = embeddedSpec(item.text);
    if (embedded) return embedded;
    try {
      const json: unknown = JSON.parse(item.text);
      if (isSpec(json)) return item.text;
    } catch { /* HTML or static initializer. */ }
    if (/^\s*openapi\s*:/m.test(item.text)) return item.text;
    const refs = [
      ...Array.from(item.text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi), match => match[1])
        .filter(ref => /\/(?:swagger-ui-init|swagger-initializer)\.js(?:\?|$)/.test(`/${ref}`)),
      ...Array.from(item.text.matchAll(/["']?configUrl["']?\s*:\s*["']([^"']+)["']/g), match => match[1]),
      ...Array.from(item.text.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g), match => match[1]),
    ];
    for (const ref of refs) {
      let target: URL;
      try { target = new URL(ref.replace(/&amp;/g, "&"), item.url); } catch { continue; }
      // Keep document credentials on the configured origin and ignore sample/external specs.
      if (target.origin !== origin || visited.has(target.href) || visited.size >= 8) continue;
      visited.add(target.href);
      try { queue.push({ url: target.href, text: await read(target.href, /\/(?:swagger-ui-init|swagger-initializer)\.js$/.test(target.pathname)) }); }
      catch (error) { failure = error; }
    }
  }
  throw failure ?? new Error(HTML_ERROR);
}
