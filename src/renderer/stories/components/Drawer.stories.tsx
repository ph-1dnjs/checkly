import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, Icon, SpecTable } from "./ComponentsUI";
import { componentById, DRAWER_METRICS, DIFFS } from "./tokens";

const COMP = componentById("comp-drawer");

function DrawerDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="DRAWER" meta="우측 560px · sticky header 48px" />
      <div className="cp-drawer-wrap">
        <div className="cp-drawer">
          <div className="cp-drawer-header">
            <span className="cp-drawer-brand">실행 리포트</span>
            <span className="cp-drawer-id">run-2026-09-14-0941</span>
            <span className="cp-drawer-header-icons">
              <Icon name="download" size={18} color="#A6AEB5" />
              <Icon name="close" size={18} color="#A6AEB5" />
            </span>
          </div>
          <div className="cp-drawer-metrics">
            {DRAWER_METRICS.map((m) => (
              <div className="cp-drawer-metric" key={m.label} style={{ borderLeft: m.line }}>
                <div className="cp-metric-label">{m.label}</div>
                <div className="cp-metric-value" style={{ fontSize: m.size, color: m.color }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>
          <div className="cp-drawer-section-bar">
            FAILED STEP
            <span className="cp-drawer-section-bar-meta">1건</span>
          </div>
          <div className="cp-drawer-body">
            <div className="cp-failblock">
              <div className="cp-failblock-title" style={{ marginBottom: 8 }}>
                단계 7 · 결과 확인
              </div>
              {DIFFS.map((d) => (
                <div className="cp-diff-row" key={d.k}>
                  <span className="cp-diff-key">{d.k}</span>
                  <span className="cp-diff-value" style={{ color: d.fg }} title={d.v}>
                    {d.v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof DrawerDoc> = {
  title: "Components/Feedback/Drawer",
  component: DrawerDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof DrawerDoc>;

export const Overview: Story = {};
