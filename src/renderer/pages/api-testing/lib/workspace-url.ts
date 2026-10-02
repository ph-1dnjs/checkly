export type ApiTab = "api" | "scenarios" | "scenario-editor" | "ai";
export type WorkspaceUrlState = {
  tab: ApiTab;
  projectId: string;
  serverId: string;
  environmentId: string;
  scenarioId: string;
};
export function readWorkspaceUrl(href: string) {
  const params = new URL(href).searchParams;
  const value = params.get("tab");
  return { tab: (value === "scenarios" || value === "scenario-editor" || value === "ai" ? value : "api") as ApiTab,
    projectId: params.get("project") ?? "", serverId: params.get("server") ?? "", environmentId: params.get("environment") ?? "", scenarioId: params.get("scenarioId") ?? "" };
}
export function workspaceUrl(href: string, state: WorkspaceUrlState, clearHash = false) {
  const url = new URL(href);
  // A Swagger hash (#/태그/operation) is kept across tabs (back on API 문서 the same API opens), but it points
  // into one project's and server's spec: another project or server drops it.
  const previousProject = url.searchParams.get("project"), previousServer = url.searchParams.get("server");
  if ((previousProject && previousProject !== state.projectId) || (previousServer && previousServer !== state.serverId)) clearHash = true;
  url.searchParams.set("tab", state.tab);
  for (const [key, value] of [["project", state.projectId], ["server", state.serverId], ["environment", state.environmentId], ["scenarioId", state.scenarioId]]) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  if (clearHash) url.hash = "";
  return url.href;
}
