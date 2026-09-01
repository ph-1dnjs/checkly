import type { Route } from "../shared/model/scenario";

type Props = {
  route: Route;
  running: boolean;
  onNavigate: (route: Route) => void;
  onRun: () => void;
  onCancel: () => void;
};

export const BottomNavigation = ({
  route,
  running,
  onNavigate,
  onRun,
  onCancel,
}: Props) => (
  <nav className="bottom-navigation" aria-label="주요 메뉴">
    <span className="bottom-nav-brand" aria-hidden="true">✓</span>
    <span className="bottom-nav-divider" aria-hidden="true" />
    <button
      className={
        route === "dashboard" ? "bottom-nav-item active" : "bottom-nav-item"
      }
      onClick={() => onNavigate("dashboard")}
      aria-label="대시보드"
    >
      <span aria-hidden="true">▥</span>
      <small>대시보드</small>
    </button>
    <button className={route === "library" ? "bottom-nav-item active" : "bottom-nav-item"} onClick={() => onNavigate("library")} aria-label="시나리오"><span aria-hidden="true">☷</span><small>시나리오</small></button>
    <button
      className={
        route === "editor" ? "bottom-nav-item active" : "bottom-nav-item"
      }
      onClick={() => onNavigate("editor")}
      aria-label="작성/편집"
    >
      <span aria-hidden="true">▣</span>
      <small>작성/편집</small>
    </button>
    <button
      className={route === "run" ? "bottom-nav-item active" : "bottom-nav-item"}
      onClick={() => onNavigate("run")}
      aria-label="실행 콘솔"
    >
      <span aria-hidden="true">▶</span>
      <small>실행</small>
    </button>
    <button
      className={
        route === "settings" ? "bottom-nav-item active" : "bottom-nav-item"
      }
      onClick={() => onNavigate("settings")}
      aria-label="설정"
    >
      <span aria-hidden="true">⚙</span>
      <small>설정</small>
    </button>
    <span className="bottom-nav-divider bottom-nav-divider-end" aria-hidden="true" />
    <button
      className={`bottom-nav-run${running ? " danger" : ""}`}
      onClick={running ? onCancel : onRun}
      aria-label={running ? "시나리오 실행 중지" : "시나리오 실행"}
    >
      <i aria-hidden="true" />
      {running ? "실행 중지" : "실행"}
    </button>
  </nav>
);
