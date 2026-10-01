/** Which server a step calls, as a coloured tag (one colour per server, by its place in the project). */
export function ServerTag({ server, names }: { server: string; names: Record<string, string> }) {
  const index = Math.max(0, Object.keys(names).indexOf(server));
  return <span className={`api-run-server api-server-tone-${index % 4}`} title={`서버 · ${names[server] ?? server}`}>{names[server] ?? server}</span>;
}

/** Steps name their server only when the scenario uses more than one. */
export const usesManyServers = (steps: Array<{ server: string }>) => new Set(steps.map(step => step.server)).size > 1;
