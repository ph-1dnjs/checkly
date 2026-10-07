import type { ApiAiChatSettings, ApiAiChatStatus, ApiAiTool } from "../../../../app/api-testing/shared/workspace";

export const aiToolNames: Record<ApiAiTool, string> = { claude: "Claude Code", codex: "Codex" };
export function chatTool(settings: ApiAiChatSettings | null, tools: ApiAiChatStatus["tools"]): ApiAiTool | undefined {
  return settings?.tool && tools.some(item => item.tool === settings.tool) ? settings.tool : tools[0]?.tool;
}
export const backendFolderCount = (settings: ApiAiChatSettings | null) => settings ? Object.values(settings.folders).flat().length : 0;
