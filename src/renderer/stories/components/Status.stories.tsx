import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, SpecTable } from "./ComponentsUI";
import { componentById, STATUSES, DOT_SIZES } from "./tokens";

const COMP = componentById("comp-status");

function StatusDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="STATE" meta="dot 8px · 정사각형" />
      <div>
        {STATUSES.map((s) => (
          <div className="cp-status-row" key={s.token}>
            <span className="cp-status-token">{s.token}</span>
            <span className="cp-status-word">
              <span className={s.running ? "cp-status-dot cp-status-dot--running" : "cp-status-dot"} style={{ background: s.color }} />
              {s.word}
            </span>
            <span className="cp-status-chip" style={{ background: s.tint, borderColor: s.line, color: s.ink }}>
              {s.word}
            </span>
            <span className="cp-status-use">{s.use}</span>
          </div>
        ))}
      </div>

      <SectionBar label="DOT SIZE" meta="8 / 7 / 6px" />
      <div className="cp-dotsize-row">
        {DOT_SIZES.map((d) => (
          <div className="cp-dotsize-item" key={d.value}>
            <span className="cp-dotsize-dot" style={{ width: d.value, height: d.value }} />
            <span className="cp-dotsize-use">
              {d.value} · {d.use}
            </span>
          </div>
        ))}
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof StatusDoc> = {
  title: "Components/Display/Status",
  component: StatusDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof StatusDoc>;

export const Overview: Story = {};
