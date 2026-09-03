import type { Route } from "../shared/model/scenario";

type Props = {
  route: Route;
  running: boolean;
  onNavigate: (route: Route) => void;
  onRun: () => void;
  onCancel: () => void;
};

const NAVS: Array<{ route: Route; label: string; icon: string }> = [
  { route: "dashboard", label: "실행 기록", icon: "history" },
  { route: "editor", label: "편집기", icon: "edit" },
  { route: "picker", label: "시나리오 선택 · 실행", icon: "playlist_play" },
  { route: "settings", label: "설정", icon: "settings" },
];

export const BottomNavigation = ({
  route,
  running,
  onNavigate,
  onRun,
  onCancel,
}: Props) => (
  <nav className="bottom-navigation" aria-label="주요 메뉴">
    <button
      className="bottom-nav-brand"
      onClick={() => onNavigate("dashboard")}
      aria-label="Checkly"
    >
      <i>
        <span className="msi" aria-hidden="true">check</span>
      </i>
      <strong>Checkly</strong>
    </button>
    <div className="bottom-nav-controls">
      {NAVS.map((item) => (
        <button
          key={item.route}
          className={route === item.route ? "bottom-nav-item active" : "bottom-nav-item"}
          onClick={() => onNavigate(item.route)}
          aria-label={item.label}
          title={item.label}
        >
          <span className="msi" aria-hidden="true">{item.icon}</span>
        </button>
      ))}
    </div>
    <button
      className={`bottom-nav-run${running ? " danger" : ""}`}
      onClick={running ? onCancel : onRun}
      aria-label={running ? "시나리오 실행 중지" : "시나리오 실행"}
    >
      <span className="msi" aria-hidden="true">
        {running ? "stop_circle" : "play_arrow"}
      </span>
      {running ? "중지" : "실행"}
    </button>
  </nav>
);
