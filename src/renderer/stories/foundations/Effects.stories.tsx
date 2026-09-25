import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar } from "./FoundationsUI";
import { SHADOWS, FX } from "./tokens";

function EffectsDoc() {
  return (
    <Page
      title="Effects"
      desc="그림자는 떠 있는 요소(dock, 토스트, 모달, 마커 핀)에만 허용됩니다. 나머지 깊이 표현은 1px 헤어라인과 옅은 표면색으로 대체합니다."
    >
      <SectionBar label="SHADOW" meta="떠 있는 요소 전용" />
      <div className="fd-shadow-grid">
        {SHADOWS.map((s) => (
          <div className="fd-shadow-card" key={s.token}>
            <div className="fd-shadow-stage">
              <span className="fd-shadow-chip" style={{ borderRadius: s.radius, boxShadow: s.value }}>
                {s.on}
              </span>
            </div>
            <div className="fd-shadow-token">{s.token}</div>
            <div className="fd-shadow-value">{s.value}</div>
            <div className="fd-shadow-use">{s.use}</div>
          </div>
        ))}
      </div>

      <SectionBar label="OVERLAY · HAIRLINE · MOTION" meta="effects" />
      {FX.map((f) => (
        <div className="fd-fx-row" key={f.token}>
          <span className="fd-fx-token">{f.token}</span>
          <span className="fd-fx-value">{f.value}</span>
          <span className="fd-fx-use">{f.use}</span>
        </div>
      ))}

      <div className="fd-fx-demo-row">
        <div className="fd-fx-demo">
          <div className="fd-fx-overlay-stage">
            <div className="fd-fx-overlay-bg" />
            <div className="fd-fx-overlay-scrim">overlay .24</div>
          </div>
        </div>
        <div className="fd-fx-demo">
          <div className="fd-fx-blink-stage">
            <span className="fd-fx-blink-dot" />
          </div>
          <div className="fd-fx-demo-caption">ckBlink 1s infinite</div>
        </div>
      </div>
    </Page>
  );
}

const meta: Meta<typeof EffectsDoc> = {
  title: "Foundations/Effects",
  component: EffectsDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof EffectsDoc>;

export const AllEffects: Story = {};

export const Shadows: Story = {
  render: () => (
    <Page title="Shadow" desc="떠 있는 요소(dock, 토스트, 모달, 마커 핀)에만 허용되는 그림자 토큰.">
      <div className="fd-shadow-grid">
        {SHADOWS.map((s) => (
          <div className="fd-shadow-card" key={s.token}>
            <div className="fd-shadow-stage">
              <span className="fd-shadow-chip" style={{ borderRadius: s.radius, boxShadow: s.value }}>
                {s.on}
              </span>
            </div>
            <div className="fd-shadow-token">{s.token}</div>
            <div className="fd-shadow-value">{s.value}</div>
            <div className="fd-shadow-use">{s.use}</div>
          </div>
        ))}
      </div>
    </Page>
  ),
};
