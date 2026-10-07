import { Button } from "../shared/ui/Button";
import {
  isScenarioWorkspaceRoute,
  type Route,
  type ScenarioWorkspaceRoute,
} from "../shared/model/scenario";
import checklyMark from "../assets/checkly-mark.png";

type Props = {
  route: Route;
  /** 시나리오 메뉴는 편집·실행을 묶은 작업공간으로, 마지막으로 본 화면으로 돌아간다. */
  lastWorkspaceRoute: ScenarioWorkspaceRoute;
  running: boolean;
  onNavigate: (route: Route) => void;
  onRun: () => void;
  onCancel: () => void;
  apiRunAction?: { run: () => void; disabled: boolean } | null;
};

const NAVS: Array<{ route: Route | "workspace"; label: string; icon: string }> =
  [
    { route: "workspace", label: "시나리오 · 편집과 실행", icon: "fact_check" },
    { route: "form-automation", label: "폼 자동 완성", icon: "auto_fix_high" },
    { route: "api-testing", label: "API 테스트", icon: "data_object" },
    { route: "settings", label: "설정", icon: "settings" },
  ];

export const BottomNavigation = ({
  route,
  lastWorkspaceRoute,
  running,
  onNavigate,
  onRun,
  onCancel,
  apiRunAction,
}: Props) => (
  <nav className="bottom-navigation" aria-label="주요 메뉴">
    <Button
      className="bottom-nav-brand"
      onClick={() => onNavigate("dashboard")}
      aria-label="Checkly"
    >
      <span className="bottom-nav-brand-mark" aria-hidden="true">
        <img src={checklyMark} alt="" />
      </span>
      <strong>
        Check<span className="bottom-nav-brand-accent">ly</span>
      </strong>
    </Button>
    <div className="bottom-nav-controls">
      {NAVS.map((item) => {
        const workspace = item.route === "workspace";
        const active = workspace
          ? isScenarioWorkspaceRoute(route)
          : route === item.route;
        return (
          <Button
            key={item.label}
            className={active ? "bottom-nav-item active" : "bottom-nav-item"}
            aria-current={active ? "page" : undefined}
            onClick={() =>
              onNavigate(
                item.route === "workspace" ? lastWorkspaceRoute : item.route,
              )
            }
            aria-label={item.label}
            title={item.label}
          >
            <span className="msi" aria-hidden="true">
              {item.icon}
            </span>
          </Button>
        );
      })}
    </div>
    {route === "api-testing" ? (
      <Button
        className="bottom-nav-run"
        disabled={!apiRunAction || apiRunAction.disabled}
        onClick={() => apiRunAction?.run()}
        aria-label="선택한 API 테스트 실행"
      >
        <span className="msi" aria-hidden="true">
          play_arrow
        </span>
        API 실행
      </Button>
    ) : (
      <Button
        className={`bottom-nav-run${running ? " danger" : ""}`}
        onClick={running ? onCancel : onRun}
        aria-label={running ? "시나리오 실행 중지" : "시나리오 실행"}
      >
        <span className="msi" aria-hidden="true">
          {running ? "stop_circle" : "play_arrow"}
        </span>
        {running ? "중지" : "실행"}
      </Button>
    )}
  </nav>
);
