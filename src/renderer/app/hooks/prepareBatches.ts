/** 묶음 실패나 응답 누락은 작은 묶음으로 격리하고 성공한 결과는 즉시 반영한다. */
export async function prepareBatches<T extends { key: string }, R extends { key: string }>(
  items: T[], request: (items: T[], reason: "initial" | "missing" | "failure") => Promise<R[]>,
  success: (result: R) => void, failure: (item: T, error: unknown) => void,
  active: () => boolean, reason: "initial" | "missing" | "failure" = "initial",
): Promise<void> {
  if (!items.length || !active()) return;
  let missing = items;
  let retryReason: "missing" | "failure" = "missing";
  let error: unknown = new Error("AI가 이 TC의 준비 결과를 반환하지 않았습니다.");
  try {
    const results = await request(items, reason);
    if (!active()) return;
    const wanted = new Set(items.map(item => item.key));
    const received = new Set<string>();
    for (const result of results) if (wanted.has(result.key) && !received.has(result.key)) {
      received.add(result.key);
      success(result);
    }
    missing = items.filter(item => !received.has(item.key));
  } catch (caught) { error = caught; retryReason = "failure"; }
  if (!active() || !missing.length) return;
  if (missing.length === 1 && items.length === 1) { failure(missing[0]!, error); return; }
  const middle = Math.ceil(missing.length / 2);
  await prepareBatches(missing.slice(0, middle), request, success, failure, active, retryReason);
  await prepareBatches(missing.slice(middle), request, success, failure, active, retryReason);
}
