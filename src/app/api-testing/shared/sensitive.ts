/** Key names whose values are secrets (headers, JSON keys, query parameters, variable names). */
export const sensitiveKeyPattern = /authorization|cookie|passw(?:or)?d|token|secret|api.?key|otp|credential|session/i;

export function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key);
}

export type TextSegment = { text: string; sensitive: boolean };

// Short values such as "1" or "abc" would mask unrelated text.
const minimumKnownLength = 4;

/**
 * Splits display text so only secret parts are masked: occurrences of known
 * secret values and values of sensitive query parameters inside URLs.
 */
export function sensitiveSegments(text: string, known: readonly string[]): TextSegment[] {
  const ranges: Array<[number, number]> = [];
  for (const value of known) {
    if (value.length < minimumKnownLength) continue;
    for (let index = text.indexOf(value); index >= 0; index = text.indexOf(value, index + value.length)) ranges.push([index, index + value.length]);
  }
  const query = /^https?:\/\/[^?#\s]*\?([^#\s]*)/.exec(text);
  if (query) {
    let offset = query.index + query[0].length - query[1].length;
    for (const pair of query[1].split("&")) {
      const separator = pair.indexOf("=");
      if (separator > 0 && pair.length > separator + 1) {
        let name = pair.slice(0, separator);
        try { name = decodeURIComponent(name.replace(/\+/g, " ")); } catch { /* Keep the raw name. */ }
        if (isSensitiveKey(name)) ranges.push([offset + separator + 1, offset + pair.length]);
      }
      offset += pair.length + 1;
    }
  }
  if (!ranges.length) return [{ text, sensitive: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const segments: TextSegment[] = [];
  let position = 0;
  for (const [start, end] of merged) {
    if (start > position) segments.push({ text: text.slice(position, start), sensitive: false });
    segments.push({ text: text.slice(start, end), sensitive: true });
    position = end;
  }
  if (position < text.length) segments.push({ text: text.slice(position), sensitive: false });
  return segments;
}
