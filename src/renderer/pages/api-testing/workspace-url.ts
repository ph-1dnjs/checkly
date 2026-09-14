export type ApiTab = "api" | "scenarios" | "ai";
export function readWorkspaceUrl(href: string) {
  const params = new URL(href).searchParams;
  const value = params.get("tab");
  return { tab: (value === "scenarios" || value === "ai" ? value : "api") as ApiTab,
    projectId: params.get("project") ?? "", serverId: params.get("server") ?? "", environmentId: params.get("environment") ?? "" };
}
export function workspaceUrl(href: string, state: ReturnType<typeof readWorkspaceUrl>) {
  const url = new URL(href);
  url.searchParams.set("tab", state.tab);
  for (const [key, value] of [["project", state.projectId], ["server", state.serverId], ["environment", state.environmentId]]) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  return url.href;
}
