import type { Route } from "../shared/model/scenario";

type Props = {
  route: Route;
  running: boolean;
  onNavigate: (route: Route) => void;
  onRun: () => void;
  onCancel: () => void;
  apiRunAction?: { run: () => void; disabled: boolean } | null;
};

const NAVS: Array<{ route?: Route; label: string; icon: string }> = [
  { route: "editor", label: "편집기", icon: "edit" },
  { route: "picker", label: "시나리오 선택 · 실행", icon: "play_circle" },
  { label: "준비 중", icon: "dynamic_form" },
  { route: "api-testing", label: "API 테스트", icon: "data_object" },
  { route: "settings", label: "설정", icon: "settings" },
];

export const BottomNavigation = ({
  route,
  running,
  onNavigate,
  onRun,
  onCancel,
  apiRunAction,
}: Props) => (
  <nav className="bottom-navigation" aria-label="주요 메뉴">
    <button
      className="bottom-nav-brand"
      onClick={() => onNavigate("dashboard")}
      aria-label="Checkly"
    >
      <span className="bottom-nav-brand-mark msi" aria-hidden="true">check</span>
      <strong>Checkly</strong>
    </button>
    <div className="bottom-nav-controls">
      {NAVS.map((item) => (
        <button
          key={item.label}
          className={route === item.route ? "bottom-nav-item active" : "bottom-nav-item"}
          disabled={!item.route}
          onClick={() => item.route && onNavigate(item.route)}
          aria-label={item.label}
          title={item.label}
        >
          <span className="msi" aria-hidden="true">{item.icon}</span>
        </button>
      ))}
    </div>
    {route === "api-testing" ? <button className="bottom-nav-run" disabled={!apiRunAction || apiRunAction.disabled} onClick={() => apiRunAction?.run()} aria-label="선택한 API 테스트 실행"><span className="msi" aria-hidden="true">play_arrow</span>API 실행</button> : <button
      className={`bottom-nav-run${running ? " danger" : ""}`}
      onClick={running ? onCancel : onRun}
      aria-label={running ? "시나리오 실행 중지" : "시나리오 실행"}
    >
      <span className="msi" aria-hidden="true">
        {running ? "stop_circle" : "play_arrow"}
      </span>
      {running ? "중지" : "실행"}
    </button>}
  </nav>
);
