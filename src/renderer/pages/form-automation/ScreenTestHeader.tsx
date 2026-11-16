import type { ReactNode } from "react";
import { Button } from "../../shared/ui/Button";

export type ScreenTestMode = "cases" | "network" | "override";

export function ScreenTestHeader({ title = "화면 테스트", icon = "devices", mode, onMode, errors = 0, overrides = 0, onBack, children }: {
  title?: string;
  icon?: string;
  mode: ScreenTestMode;
  onMode: (mode: ScreenTestMode) => void;
  errors?: number;
  overrides?: number;
  onBack?: () => void;
  children: ReactNode;
}) {
  const modes = [
    ...(!onBack ? [{ id: "cases" as const, icon: "edit_note", label: "폼 입력", count: 0 }] : []),
    { id: "network" as const, icon: "lan", label: "네트워크", count: errors },
    { id: "override" as const, icon: "swap_horiz", label: "응답 오버라이드", count: overrides },
  ];
  return <header className="fa-screen-header">
    <div className="fa-screen-title">
      {onBack && <Button variant="ghost" iconOnly onClick={onBack} aria-label="화면 테스트로 돌아가기"><span className="msi" aria-hidden="true">chevron_left</span></Button>}
      <span className="msi" aria-hidden="true">{icon}</span><h1>{title}</h1>
    </div>
    <div className="fa-mode-tabs" role="tablist" aria-label="작업 선택">
      {modes.map((item, index) => <Button key={item.id} role="tab" aria-selected={mode === item.id} tabIndex={mode === item.id ? 0 : -1}
        onClick={() => onMode(item.id)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
          onMode(modes[next].id);
          (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
        }}><span className="msi" aria-hidden="true">{item.icon}</span>{item.label}
        {item.count > 0 && <b className={item.id === "network" ? "error" : ""}>{item.count}</b>}
      </Button>)}
    </div>
    <div className="fa-header-actions">{children}</div>
  </header>;
}
