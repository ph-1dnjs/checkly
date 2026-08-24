import type { Route } from "../shared/model/scenario";

type Props = { route: Route; onNavigate: (route: Route) => void };

export const BottomNavigation = ({ route, onNavigate }: Props) => (
  <nav className="bottom-navigation" aria-label="주요 메뉴">
    <button
      className={
        route === "scenarios" ? "bottom-nav-item active" : "bottom-nav-item"
      }
      onClick={() => onNavigate("scenarios")}
      aria-label="대시보드"
    >
      <span aria-hidden="true">⌂</span>
      <small>대시보드</small>
    </button>
    <button
      className={
        route === "editor" ? "bottom-nav-item active" : "bottom-nav-item"
      }
      onClick={() => onNavigate("editor")}
      aria-label="작성/편집"
    >
      <span aria-hidden="true">⌖</span>
      <small>작성/편집</small>
    </button>
    <button
      className={route === "run" ? "bottom-nav-item active" : "bottom-nav-item"}
      onClick={() => onNavigate("run")}
      aria-label="실행 콘솔"
    >
      <span aria-hidden="true">▷</span>
      <small>실행</small>
    </button>
  </nav>
);
