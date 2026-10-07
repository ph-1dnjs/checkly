import { useRef, useState } from "react";
import { aiToolNames, chatTool } from "../../../../entities/api-testing";
import type { ApiAiChatSettings, ApiAiChatStatus, ApiAiEffort, ApiTestingBridge, ApiAiTool } from "../../../../../app/api-testing/shared/workspace";

export const aiEffortNames: Record<ApiAiEffort, string> = { low: "빠르게", medium: "보통", high: "깊게" };

/** Short line for the folded settings, e.g. "Claude Code · 빠르게". */
export function aiSettingsSummary(settings: ApiAiChatSettings, status: ApiAiChatStatus): string {
  const tool = chatTool(settings, status.tools);
  return [tool ? aiToolNames[tool] : "AI 없음", settings.effort ? `추론 ${aiEffortNames[settings.effort]}` : "추론 기본"].join(" · ");
}

/** Which installed AI and effort the next chat (start or reset) uses; the model is each CLI's default. */
export function AiToolSettings({ projectId, bridge, status, settings, disabled, onBusy, onSaved }: {
  projectId: string; bridge: ApiTestingBridge; status: ApiAiChatStatus; settings: ApiAiChatSettings; disabled: boolean;
  onBusy: (busy: boolean) => void; onSaved: (settings: ApiAiChatSettings) => void;
}) {
  const [tool, setTool] = useState(chatTool(settings, status.tools));
  const [effort, setEffort] = useState<ApiAiEffort | "">(settings.effort ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const save = async () => {
    if (disabled || saving.current || !tool) return;
    saving.current = true; onBusy(true); setError(""); setSaved(false);
    try {
      const next = await bridge.saveAiChatSettings(projectId, { folders: settings.folders, tool, ...(effort ? { effort } : {}) });
      onSaved(next); setSaved(true);
    } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
    finally { saving.current = false; onBusy(false); }
  };
  if (!tool) return null;
  return <section className="api-ai-tool-settings" aria-label="AI 실행 설정">
    <label>사용할 AI<select aria-label="사용할 AI" value={tool} disabled={disabled} onChange={e => { setTool(e.target.value as ApiAiTool); setSaved(false); }}>{status.tools.map(item => <option key={item.tool} value={item.tool}>{aiToolNames[item.tool]} · {item.version}</option>)}</select></label>
    <label>추론 수준<select aria-label="추론 수준" value={effort} disabled={disabled} onChange={e => { setEffort(e.target.value as ApiAiEffort | ""); setSaved(false); }}>
      <option value="">CLI 기본값</option>
      {(Object.keys(aiEffortNames) as ApiAiEffort[]).map(item => <option key={item} value={item}>{aiEffortNames[item]} ({item})</option>)}
    </select></label>
    <button type="button" disabled={disabled} onClick={() => void save()}>AI 설정 저장</button>
    <p>모델은 각 CLI의 기본값을 씁니다. 추론 수준이 낮을수록 빨리 답하고, 높을수록 코드를 더 꼼꼼히 봅니다. 바꾼 설정은 대화 시작·초기화부터 적용됩니다.</p>
    {saved && <p role="status">AI 설정을 저장했습니다.</p>}
    {error && <p className="api-warning" role="alert">{error}</p>}
  </section>;
}
