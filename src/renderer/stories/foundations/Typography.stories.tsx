import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout } from "./FoundationsUI";
import { FAMILIES, TEXT_STYLES, TYPE_RULES } from "./tokens";

function TypographyDoc() {
  return (
    <Page
      title="Typography"
      desc="Nunito(제목) · Helvetica 계열(UI) · D2Coding(데이터) 세 패밀리로 구성됩니다. 텍스트 스타일은 고밀도 화면 기준으로 11–13px 본문 구간이 촘촘하고, 지표 숫자만 크게 벌어집니다."
    >
      <SectionBar label="FONT FAMILY" meta={`${FAMILIES.length} families`} />
      <div className="fd-family-grid">
        {FAMILIES.map((f) => (
          <div className="fd-family-card" key={f.token}>
            <div className="fd-family-head">
              <span className="fd-family-role">{f.role}</span>
              <span className="fd-family-token">{f.token}</span>
            </div>
            <div className="fd-family-sample" style={{ fontFamily: f.css, fontWeight: f.weight }}>
              {f.sample}
            </div>
            <div className="fd-family-sample-ko" style={{ fontFamily: f.css }}>
              {f.sampleKo}
            </div>
            <div className="fd-family-stack">{f.stack}</div>
            <div className="fd-family-use">{f.use}</div>
          </div>
        ))}
      </div>

      <SectionBar label="TEXT STYLES" meta="size / line-height / letter-spacing" />
      <div className="fd-thead">
        <span className="w-token">토큰</span>
        <span className="w-sample">샘플</span>
        <span className="w-size">size</span>
        <span className="w-lh">line-height</span>
        <span className="w-ls">letter-spacing</span>
        <span className="w-weight">weight</span>
      </div>
      {TEXT_STYLES.map((t) => (
        <div className="fd-type-row" key={t.token}>
          <span className="fd-type-token-col">
            <span className="fd-type-token">{t.token}</span>
            <span className="fd-type-role">{t.role}</span>
          </span>
          <span
            className="fd-type-sample"
            title={t.sample}
            style={{
              color: t.color,
              fontFamily: t.family,
              fontSize: t.size,
              lineHeight: t.lh,
              letterSpacing: t.ls,
              fontWeight: t.weight,
              fontVariantNumeric: t.num,
            }}
          >
            {t.sample}
          </span>
          <span className="fd-type-meta">
            <span className="w-size">{t.size}</span>
            <span className="w-lh">{t.lh}</span>
            <span className="w-ls">{t.ls}</span>
            <span className="w-weight">{t.weight}</span>
          </span>
        </div>
      ))}

      <Callout label="USAGE" rules={TYPE_RULES} />
    </Page>
  );
}

const meta: Meta<typeof TypographyDoc> = {
  title: "Foundations/Typography",
  component: TypographyDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof TypographyDoc>;

export const AllTextStyles: Story = {};

export const FontFamilies: Story = {
  render: () => (
    <Page title="Font Family" desc="Checkly 디자인 시스템의 세 가지 폰트 패밀리.">
      <div className="fd-family-grid">
        {FAMILIES.map((f) => (
          <div className="fd-family-card" key={f.token}>
            <div className="fd-family-head">
              <span className="fd-family-role">{f.role}</span>
              <span className="fd-family-token">{f.token}</span>
            </div>
            <div className="fd-family-sample" style={{ fontFamily: f.css, fontWeight: f.weight }}>
              {f.sample}
            </div>
            <div className="fd-family-sample-ko" style={{ fontFamily: f.css }}>
              {f.sampleKo}
            </div>
            <div className="fd-family-stack">{f.stack}</div>
            <div className="fd-family-use">{f.use}</div>
          </div>
        ))}
      </div>
    </Page>
  ),
};
