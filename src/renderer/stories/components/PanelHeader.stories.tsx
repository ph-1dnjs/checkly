import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, Icon, SpecTable } from "./ComponentsUI";
import { componentById, PANELS, METRICS } from "./tokens";

const COMP = componentById("comp-panel");

function PanelHeaderDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="HEADER BAR" meta="26px · sticky top 0" />
      <div className="cp-panel-grid">
        {PANELS.map((p) => (
          <div className="cp-panel-cell" key={p.token}>
            <div className="cp-panel-token">{p.token}</div>
            <div className="cp-panel-box">
              <div className="cp-panel-bar">
                {p.icon && <Icon name={p.icon} size={14} color="#A6AEB5" />}
                {p.label}
                <span className="cp-panel-bar-meta" style={{ color: p.metaFg }}>
                  {p.meta}
                </span>
              </div>
              <div className="cp-panel-body">{p.body}</div>
            </div>
            <div className="cp-panel-use">{p.use}</div>
          </div>
        ))}
      </div>

      <SectionBar label="METRIC STRIP" meta="지표 · 위아래 헤어라인" />
      <div className="cp-row-block">
        <div className="cp-metric-strip">
          {METRICS.map((m) => (
            <div className="cp-metric-cell" key={m.label} style={{ borderLeft: m.line }}>
              <div className="cp-metric-label">{m.label}</div>
              <div className="cp-metric-value" style={{ fontSize: m.size, color: m.color }}>
                {m.value}
              </div>
              <div className="cp-metric-meta">{m.meta}</div>
            </div>
          ))}
        </div>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof PanelHeaderDoc> = {
  title: "Components/Layout/Panel Header",
  component: PanelHeaderDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof PanelHeaderDoc>;

export const Overview: Story = {};
