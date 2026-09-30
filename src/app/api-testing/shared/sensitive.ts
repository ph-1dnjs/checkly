/**
 * Key names whose values are secrets (headers, JSON keys, query parameters, variable names).
 * Used to keep them out of stored data (remembered docs inputs, extraction flags), not to hide them on screen.
 */
export const sensitiveKeyPattern = /authorization|cookie|passw(?:or)?d|token|secret|api.?key|otp|credential|session/i;

export function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key);
}
