import type { Meta, StoryObj } from "@storybook/react-vite";
import checklyMark from "../../assets/checkly-mark.png";
import { Page, SectionBar, Callout, Icon, SpecTable } from "./ComponentsUI";
import { componentById, DOCK_ICONS, DOCK_ACTIONS, LOGS } from "./tokens";

const COMP = componentById("comp-dock");

function DockConsoleDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="DOCK" meta="캡슐 46px · gap 10px · bottom 22px" />
      <div className="cp-dock-stage cp-stage-diag">
        <div className="cp-dock-row">
          <div className="cp-dock-capsule cp-dock-capsule--brand" title="대시보드로 이동">
            <span className="cp-dock-mark">
              <img src={checklyMark} alt="Checkly" />
            </span>
            <span className="cp-dock-wordmark">
              Check<span style={{ color: "#7FB0E8" }}>ly</span>
            </span>
          </div>
          <div className="cp-dock-capsule cp-dock-capsule--nav">
            {DOCK_ICONS.map((d) => (
              <span
                key={d.icon}
                title={d.label}
                className={d.active ? "cp-dock-icon-btn cp-dock-icon-btn--active" : "cp-dock-icon-btn"}
                style={{ cursor: d.disabled ? "not-allowed" : "pointer" }}
              >
                <Icon name={d.icon} size={21} color={d.active ? "#FFFFFF" : d.disabled ? "#4A545D" : "#98A4AE"} />
              </span>
            ))}
          </div>
          {DOCK_ACTIONS.map((a) => (
            <div className="cp-dock-capsule cp-dock-capsule--action" style={{ background: a.bg }} key={a.icon}>
              <Icon name={a.icon} size={21} />
              <span className="cp-dock-action-label">{a.label}</span>
              <span className="cp-dock-meta">{a.meta}</span>
            </div>
          ))}
        </div>
        <div className="cp-dock-caption">브랜드(대시보드로 이동) · 내비게이션 5칸 · 상황 액션(대기 #1F63AE / 실행 중 #97180F)</div>
      </div>

      <SectionBar label="CONSOLE" meta="어두운 표면 · 200px" />
      <div className="cp-console-wrap">
        <div className="cp-console">
          <div className="cp-console-header">
            CONSOLE
            <span className="cp-console-header-meta">{LOGS.length} lines</span>
          </div>
          <div className="cp-console-body">
            {LOGS.map((l, i) => (
              <span key={i} className="cp-console-line" style={{ color: l.fg }}>
                {l.text}
              </span>
            ))}
          </div>
        </div>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof DockConsoleDoc> = {
  title: "Components/Navigation/Dock · Console",
  component: DockConsoleDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof DockConsoleDoc>;

export const Overview: Story = {};
