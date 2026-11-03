import type { ApiMcpStatus, ApiProject } from "../../../../app/api-testing/shared/workspace";

export type WorkspacePreference = { serverId: string; environmentId: string };
type WorkspaceUrlSelection = { serverId: string; environmentId: string };
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const preferenceKey = (projectId: string) => `checkly.api-testing.workspace.${projectId}`;

export function readWorkspacePreference(projectId: string, storage: StorageLike = window.localStorage): WorkspacePreference | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(preferenceKey(projectId)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const { serverId, environmentId } = value as Record<string, unknown>;
    return typeof serverId === "string" && typeof environmentId === "string" ? { serverId, environmentId } : null;
  } catch { return null; }
}

export function writeWorkspacePreference(projectId: string, preference: WorkspacePreference, storage: StorageLike = window.localStorage): void {
  try { storage.setItem(preferenceKey(projectId), JSON.stringify(preference)); }
  catch { /* The workspace still works with its current selection when local storage is unavailable. */ }
}

export function resolveWorkspacePreference(project: ApiProject, url: WorkspaceUrlSelection, saved: WorkspacePreference | null, mcp: ApiMcpStatus): WorkspacePreference {
  const serverId = [url.serverId, saved?.serverId].find(id => project.servers.some(server => server.id === id)) ?? project.servers[0]?.id ?? "";
  const mcpEnvironment = mcp.enabled && mcp.projectId === project.id ? mcp.environmentId : "";
  const environmentId = [url.environmentId, saved?.environmentId, mcpEnvironment].find(id => project.environments.some(environment => environment.id === id)) ?? project.environments[0]?.id ?? "";
  return { serverId, environmentId };
}
