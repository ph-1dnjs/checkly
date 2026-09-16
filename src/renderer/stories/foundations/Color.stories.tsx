import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout } from "./FoundationsUI";
import { COLOR_GROUPS, COLOR_RULES } from "./tokens";

function ColorDoc() {
  return (
    <Page
      title="Color"
      desc="순백 캔버스 위에서 면을 나누는 것은 배경색이 아니라 헤어라인입니다. 강조는 파랑 2단(#3D8CE0 면 / #1F63AE 액션)으로 통일하고, 의미색은 통과·실패·대기 세 가지만 씁니다."
    >
      {COLOR_GROUPS.map((g) => (
        <div className="fd-color-group" key={g.label}>
          <SectionBar label={g.label} meta={g.meta} />
          <div className="fd-color-grid">
            {g.items.map((c) => (
              <div className="fd-swatch-cell" key={c.token}>
                <span className="fd-swatch" style={{ background: c.hex }} />
                <span>
                  <span className="fd-swatch-token">{c.token}</span>
                  <span className="fd-swatch-hex">{c.hex}</span>
                  <span className="fd-swatch-use">{c.use}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Callout label="USAGE" rules={COLOR_RULES} />
    </Page>
  );
}

const meta: Meta<typeof ColorDoc> = {
  title: "Foundations/Color",
  component: ColorDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ColorDoc>;

export const AllColors: Story = {};

export const ByGroup: Story = {
  render: () => (
    <>
      {COLOR_GROUPS.map((g) => (
        <Page key={g.label} title={g.label} desc={g.meta}>
          <div className="fd-color-grid">
            {g.items.map((c) => (
              <div className="fd-swatch-cell" key={c.token}>
                <span className="fd-swatch" style={{ background: c.hex }} />
                <span>
                  <span className="fd-swatch-token">{c.token}</span>
                  <span className="fd-swatch-hex">{c.hex}</span>
                  <span className="fd-swatch-use">{c.use}</span>
                </span>
              </div>
            ))}
          </div>
        </Page>
      ))}
    </>
  ),
};
