import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, Icon, SpecTable } from "./ComponentsUI";
import { componentById, BUTTON_VARIANTS, BUTTON_SIZES } from "./tokens";

const COMP = componentById("comp-button");

function ButtonDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="VARIANT" meta="default · hover · disabled" />
      <div className="cp-btn-table">
        {BUTTON_VARIANTS.map((v) => (
          <div className="cp-btn-row" key={v.token}>
            <span className="cp-btn-row-label">
              <span className="cp-btn-row-token">{v.token}</span>
              <span className="cp-btn-row-name">{v.name}</span>
            </span>
            <span className="cp-btn-chip" style={{ border: v.border, background: v.bg, color: v.fg }}>
              {v.label}
            </span>
            <span className="cp-btn-chip" style={{ border: v.hoverBorder, background: v.hoverBg, color: v.hoverFg }}>
              {v.label}
            </span>
            <span className="cp-btn-chip" style={{ border: v.disabledBorder, background: v.disabledBg, color: "#A6AEB5" }}>
              {v.label}
            </span>
            <span className="cp-btn-row-use">{v.use}</span>
          </div>
        ))}
      </div>

      <SectionBar label="SIZE" meta="높이 고정 · 좌우 패딩만 조정" />
      <div className="cp-btn-sizes-row">
        {BUTTON_SIZES.map((s) => (
          <div className="cp-btn-size-item" key={s.h}>
            <span className="cp-btn-size-chip" style={{ height: s.h, padding: s.pad, fontSize: s.fs }}>
              전체 실행
            </span>
            <span className="cp-btn-size-use">{s.use}</span>
          </div>
        ))}
      </div>

      <SectionBar label="CONTENT" meta="아이콘 · 단축키 · 아이콘 단독" />
      <div className="cp-btn-content-row">
        <span className="cp-btn-chip" style={{ background: "#1F63AE", color: "#FFFFFF" }}>
          <Icon name="play_arrow" size={16} />
          전체 실행
          <span className="cp-btn-shortcut">⌘↵</span>
        </span>
        <span className="cp-btn-chip" style={{ height: 30, padding: "0 12px", border: "1px solid #D8DDE2", background: "#FFFFFF", color: "#3D4650", gap: 8 }}>
          <Icon name="edit" size={16} color="#5A646E" />
          편집
        </span>
        <span className="cp-btn-chip" style={{ height: 30, padding: "0 12px", color: "#5A646E", gap: 8 }}>
          <Icon name="history" size={16} />
          실행 기록
        </span>
        <span className="cp-btn-square" style={{ border: "1px solid #D8DDE2", background: "#FFFFFF" }} title="복제">
          <Icon name="content_copy" size={16} color="#5A646E" />
        </span>
        <span className="cp-btn-square" style={{ color: "#5A646E" }} title="삭제">
          <Icon name="delete" size={18} />
        </span>
        <span className="cp-btn-chip" style={{ height: 30, padding: "0 12px", border: "1px dashed #B9D4F1", background: "#FFFFFF", color: "#1F63AE", fontSize: 12, gap: 6 }}>
          <Icon name="add" size={16} />
          단계 추가
        </span>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof ButtonDoc> = {
  title: "Components/Controls/Button",
  component: ButtonDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ButtonDoc>;

export const Overview: Story = {};
