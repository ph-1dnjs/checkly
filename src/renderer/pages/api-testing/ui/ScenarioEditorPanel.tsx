import type { ScenarioPanelProps } from "./ScenarioPanel";
import { ScenarioPanel } from "./ScenarioPanel";

/**
 * 시나리오 작성·수정 전용 탭입니다.
 * 실행 탭과 같은 목록/상태를 사용하지만, 편집기는 이 화면에서만 엽니다.
 */
export function ScenarioEditorPanel(props: Omit<ScenarioPanelProps, "mode">) {
  return <ScenarioPanel {...props} mode="editor" />;
}
