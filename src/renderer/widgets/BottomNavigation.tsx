import { useEffect, useRef, useState, type RefObject } from "react";
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

/** 독 뒤 배경의 밝기를 샘플링해 유리 톤(light/dark)을 결정한다. */
const useBackdropTone = (ref: RefObject<HTMLElement | null>) => {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const probe = () => {
      const nav = ref.current;
      if (!nav) return;
      const b = nav.getBoundingClientRect();
      let darkHits = 0;
      let hits = 0;
      nav.style.visibility = "hidden";
      for (const fx of [0.15, 0.5, 0.85]) {
        let el = document.elementFromPoint(
          b.left + b.width * fx,
          b.top + b.height / 2,
        ) as HTMLElement | null;
        while (el) {
          const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
          if (m && (m[3] === undefined || +m[3] > 0.5)) {
            const L = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
            hits++;
            if (L < 110) darkHits++;
            break;
          }
          el = el.parentElement;
        }
      }
      nav.style.visibility = "";
      setDark(hits > 0 && darkHits * 2 >= hits);
    };
    probe();
    const id = window.setInterval(probe, 400);
    return () => window.clearInterval(id);
  }, [ref]);
  return dark;
};

export const BottomNavigation = ({
  route,
  lastWorkspaceRoute,
  running,
  onNavigate,
  onRun,
  onCancel,
  apiRunAction,
}: Props) => {
  const navRef = useRef<HTMLElement>(null);
  const dark = useBackdropTone(navRef);

  return (
    <nav
      ref={navRef}
      className="bottom-navigation"
      data-tone={dark ? "dark" : "light"}
      aria-label="주요 메뉴"
    >
      <Button
        className="bottom-nav-brand bottom-nav-glass"
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
      <div className="bottom-nav-controls bottom-nav-glass">
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
                onNavigate(workspace ? lastWorkspaceRoute : (item.route as Route))
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
          실행
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
};
