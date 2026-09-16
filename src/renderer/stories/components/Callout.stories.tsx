import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, SpecTable } from "./ComponentsUI";
import { componentById, CALLOUTS, DIFFS } from "./tokens";

const COMP = componentById("comp-callout");

function CalloutDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="CALLOUT" meta="좌측 3px 의미색 막대" />
      <div className="cp-callout-list">
        {CALLOUTS.map((c) => (
          <div className="cp-callout" style={{ background: c.bg }} key={c.label}>
            <div style={{ background: c.bar }} />
            <div className="cp-callout-body">
              <div className="cp-callout-label" style={{ color: c.ink }}>
                {c.label}
              </div>
              <div className="cp-callout-text">{c.text}</div>
              {c.action && (
                <div className="cp-callout-actions">
                  <span className="cp-callout-action cp-callout-action--primary">{c.action}</span>
                  <span className="cp-callout-action cp-callout-action--secondary">건너뛰기</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <SectionBar label="FAILURE BLOCK" meta="기대값 · 실제값 · 선택자" />
      <div className="cp-failblock-wrap">
        <div className="cp-failblock">
          <div className="cp-failblock-head">
            <span className="cp-failblock-dot" />
            <span className="cp-failblock-title">단계 7 · 결과 확인 실패</span>
            <span className="cp-failblock-time">00:08.120</span>
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

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof CalloutDoc> = {
  title: "Components/Feedback/Callout",
  component: CalloutDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof CalloutDoc>;

export const Overview: Story = {};
