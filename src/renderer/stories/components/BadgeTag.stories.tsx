import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, SpecTable } from "./ComponentsUI";
import { componentById, BADGES, OP_TAGS } from "./tokens";

const COMP = componentById("comp-badge");

function BadgeTagDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="MICRO BADGE" meta="mono 9.5px · padding 1px 5px" />
      <div className="cp-badge-row">
        {BADGES.map((b) => (
          <span
            key={b.label}
            className="cp-badge-micro"
            style={{ background: b.bg, borderColor: b.border, color: b.fg }}
            title={b.use}
          >
            {b.label}
          </span>
        ))}
      </div>

      <SectionBar label="OPERATION TAG" meta="19px · 고정 폭 86px" />
      <div>
        {OP_TAGS.map((o) => (
          <div className="cp-optag-row" key={o.token}>
            <span className="cp-tag-op" style={{ background: o.bg, color: o.fg }} title={o.label}>
              {o.label}
            </span>
            <span className="cp-optag-token">{o.token}</span>
            <span className="cp-optag-use" title={o.use}>
              {o.use}
            </span>
          </div>
        ))}
      </div>

      <SectionBar label="TEXT TAG" meta="배지 대신 모노 텍스트" />
      <div className="cp-texttag-row">
        <span className="cp-texttag" style={{ fontSize: 9.5, color: "#8A939C" }}>
          linked
        </span>
        <span className="cp-texttag" style={{ fontSize: 9.5, color: "#96690C" }}>
          unlinked
        </span>
        <span className="cp-texttag" style={{ fontSize: 10.5, color: "#8A939C" }}>
          2026-09-14 09:41
        </span>
        <span className="cp-texttag" style={{ fontSize: 10.5, color: "#8A939C" }}>
          4 / 12
        </span>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof BadgeTagDoc> = {
  title: "Components/Display/Badge · Tag",
  component: BadgeTagDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof BadgeTagDoc>;

export const Overview: Story = {};
