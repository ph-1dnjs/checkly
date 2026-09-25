import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar } from "./FoundationsUI";
import { SPACES, PADDINGS, RADII, HEIGHTS } from "./tokens";

const maxSpace = Math.max(...SPACES.map((s) => parseFloat(s.value)));

function DimensionsDoc() {
  return (
    <Page
      title="Dimensions"
      desc="2px 배수 스케일을 씁니다. 목록 간격은 gap이 아니라 구분선으로 만들고, gap은 컨트롤이 나란히 놓일 때만 사용합니다. 기본 radius는 4px입니다."
    >
      <SectionBar label="SPACE SCALE" meta="margin · padding · gap" />
      <div className="fd-thead">
        <span className="w-dim-token">토큰</span>
        <span className="w-dim-value">값</span>
        <span className="w-dim-use">사용</span>
        <span className="w-dim-ratio">비율</span>
      </div>
      {SPACES.map((s) => (
        <div className="fd-space-row" key={s.token}>
          <span className="fd-space-token">{s.token}</span>
          <span className="fd-space-value">{s.value}</span>
          <span className="fd-space-use" title={s.use}>
            {s.use}
          </span>
          <span className="fd-space-ratio">
            <span style={{ width: `${(parseFloat(s.value) / maxSpace) * 100}%` }} />
          </span>
        </div>
      ))}

      <SectionBar label="PADDING PRESETS" meta="컨테이너별 내부 여백" />
      <div className="fd-padding-grid">
        {PADDINGS.map((p) => (
          <div className="fd-padding-card" key={p.token}>
            <div className="fd-padding-token">{p.token}</div>
            <div className="fd-padding-demo" style={{ padding: p.value }}>
              <div className="fd-padding-demo-inner">content</div>
            </div>
            <div className="fd-padding-value">{p.value}</div>
            <div className="fd-padding-use">{p.use}</div>
          </div>
        ))}
      </div>

      <SectionBar label="BORDER RADIUS" meta="4종" />
      <div className="fd-radius-grid">
        {RADII.map((r) => (
          <div className="fd-radius-card" key={r.token}>
            <div className="fd-radius-demo-wrap">
              <span className="fd-radius-demo" style={{ borderRadius: r.value }} />
            </div>
            <div className="fd-radius-token">{r.token}</div>
            <div className="fd-radius-value">{r.value}</div>
            <div className="fd-radius-use">{r.use}</div>
          </div>
        ))}
      </div>

      <SectionBar label="CONTROL HEIGHT" meta="고정 높이" />
      <div className="fd-height-row">
        {HEIGHTS.map((h) => (
          <div className="fd-height-item" key={h.value}>
            <div className="fd-height-demo" style={{ height: h.value }}>
              {h.value}
            </div>
            <div className="fd-height-use">{h.use}</div>
          </div>
        ))}
      </div>
    </Page>
  );
}

const meta: Meta<typeof DimensionsDoc> = {
  title: "Foundations/Dimensions",
  component: DimensionsDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof DimensionsDoc>;

export const AllDimensions: Story = {};

export const SpaceScale: Story = {
  render: () => (
    <Page title="Space Scale" desc="Margin · Padding · Gap 에 쓰이는 2px 배수 간격 스케일.">
      <div className="fd-thead">
        <span className="w-dim-token">토큰</span>
        <span className="w-dim-value">값</span>
        <span className="w-dim-use">사용</span>
        <span className="w-dim-ratio">비율</span>
      </div>
      {SPACES.map((s) => (
        <div className="fd-space-row" key={s.token}>
          <span className="fd-space-token">{s.token}</span>
          <span className="fd-space-value">{s.value}</span>
          <span className="fd-space-use" title={s.use}>
            {s.use}
          </span>
          <span className="fd-space-ratio">
            <span style={{ width: `${(parseFloat(s.value) / maxSpace) * 100}%` }} />
          </span>
        </div>
      ))}
    </Page>
  ),
};

export const BorderRadius: Story = {
  render: () => (
    <Page title="Border Radius" desc="4종의 radius 토큰.">
      <div className="fd-radius-grid">
        {RADII.map((r) => (
          <div className="fd-radius-card" key={r.token}>
            <div className="fd-radius-demo-wrap">
              <span className="fd-radius-demo" style={{ borderRadius: r.value }} />
            </div>
            <div className="fd-radius-token">{r.token}</div>
            <div className="fd-radius-value">{r.value}</div>
            <div className="fd-radius-use">{r.use}</div>
          </div>
        ))}
      </div>
    </Page>
  ),
};
