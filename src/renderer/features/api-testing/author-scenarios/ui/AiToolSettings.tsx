import { useRef, useState } from "react";
import { aiToolNames, chatTool } from "../../../../entities/api-testing";
import type { ApiAiChatSettings, ApiAiChatStatus, ApiTestingBridge, ApiAiTool } from "../../../../../app/api-testing/shared/workspace";

/**
 * Which installed AI the next chat uses; saved as soon as it is picked. Shown only when there is a choice.
 * A conversation cannot move to another CLI's session, so while one exists the choice is locked to its AI.
 */
export function AiToolSettings({ projectId, bridge, status, settings, lockedTool, disabled, onBusy, onSaved }: {
  projectId: string; bridge: ApiTestingBridge; status: ApiAiChatStatus; settings: ApiAiChatSettings; disabled: boolean;
  /** The AI of the current conversation; the choice is shown but cannot change. */
  lockedTool?: ApiAiTool;
  onBusy: (busy: boolean) => void; onSaved: (settings: ApiAiChatSettings) => void;
}) {
  const [error, setError] = useState("");
  const saving = useRef(false);
  // Shown checked right away; reverted if saving fails.
  const [picked, setPicked] = useState<ApiAiTool | null>(null);
  const tool = lockedTool ?? picked ?? chatTool(settings, status.tools);
  const pick = async (next: ApiAiTool) => {
    if (disabled || lockedTool || saving.current || next === tool) return;
    saving.current = true; onBusy(true); setError(""); setPicked(next);
    try { onSaved(await bridge.saveAiChatSettings(projectId, { folders: settings.folders, tool: next })); }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
    finally { setPicked(null); saving.current = false; onBusy(false); }
  };
  if (status.tools.length < 2) return null;
  return <section className="api-ai-tool-settings" aria-label="AI 실행 설정">
    <div role="radiogroup" aria-label="사용할 AI" aria-disabled={lockedTool ? true : undefined} title={lockedTool ? "AI를 바꾸려면 대화를 초기화하세요" : undefined}>
      <span>AI</span>
      {status.tools.map(item => <label key={item.tool} className="api-check-row" title={item.version}>
        <input type="radio" name={`api-ai-tool-${projectId}`} checked={tool === item.tool} disabled={disabled || Boolean(lockedTool)} onChange={() => void pick(item.tool)} />{aiToolNames[item.tool]}
      </label>)}
      {lockedTool && <small>바꾸려면 대화 초기화</small>}
    </div>
    {error && <p className="api-warning" role="alert">{error}</p>}
  </section>;
}
