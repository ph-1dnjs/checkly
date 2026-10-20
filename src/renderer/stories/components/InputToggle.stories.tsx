import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, Icon, SpecTable } from "./ComponentsUI";
import { componentById } from "./tokens";
import { Input, PasswordInput } from "../../shared/ui/Input";

const COMP = componentById("comp-form");

function InputToggleDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      {(["large", "small"] as const).map((size) => (
        <div key={size}>
          <SectionBar label={`TEXT INPUT · ${size.toUpperCase()}`} meta={size === "large" ? "44px" : "32px"} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, padding: "16px 0" }}>
            <Input size={size} placeholder="닉네임" aria-label={`${size} 기본`} />
            <Input size={size} mono defaultValue="checkly-team" aria-label={`${size} 모노`} />
            <PasswordInput size={size} placeholder="비밀번호" aria-label={`${size} 비밀번호`} />
            <Input size={size} leading={<Icon name="search" size={size === "large" ? 18 : 16} />} placeholder="검색" aria-label={`${size} 검색`} />
            <Input size={size} invalid defaultValue="잘못된 값" aria-label={`${size} 오류`} />
            <Input size={size} disabled defaultValue="비활성" aria-label={`${size} 비활성`} />
          </div>
        </div>
      ))}

      <SectionBar label="CHECKBOX · TOGGLE" meta="16px · 26×15px" />
      <div className="cp-toggle-row">
        <div className="cp-toggle-col">
          <span className="cp-toggle-state">
            <span className="cp-checkbox cp-checkbox--checked">
              <Icon name="check" size={13} color="#FFFFFF" />
            </span>
            checked
          </span>
          <span className="cp-toggle-state">
            <span className="cp-checkbox cp-checkbox--unchecked" />
            unchecked
          </span>
          <span className="cp-toggle-state cp-toggle-state--disabled">
            <span className="cp-checkbox cp-checkbox--disabled" />
            disabled
          </span>
          <span className="cp-toggle-caption">comp/checkbox</span>
        </div>
        <div className="cp-toggle-col">
          <span className="cp-toggle-state">
            <span className="cp-toggle-track cp-toggle-track--on">
              <span className="cp-toggle-knob cp-toggle-knob--on" />
            </span>
            on
          </span>
          <span className="cp-toggle-state">
            <span className="cp-toggle-track cp-toggle-track--off">
              <span className="cp-toggle-knob" />
            </span>
            off
          </span>
          <span className="cp-toggle-state cp-toggle-state--disabled">
            <span className="cp-toggle-track cp-toggle-track--disabled">
              <span className="cp-toggle-knob" />
            </span>
            disabled
          </span>
          <span className="cp-toggle-caption">comp/toggle</span>
        </div>
        <div className="cp-toggle-col cp-toggle-col-wide">
          <div className="cp-setting-row">
            뷰포트 표시
            <span className="cp-toggle-track cp-toggle-track--on">
              <span className="cp-toggle-knob cp-toggle-knob--on" />
            </span>
          </div>
          <div className="cp-setting-row">
            실패 시 중단
            <span className="cp-toggle-track cp-toggle-track--off">
              <span className="cp-toggle-knob" />
            </span>
          </div>
          <span className="cp-toggle-caption">설정 행 안에서</span>
        </div>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof InputToggleDoc> = {
  title: "Components/Controls/Input · Toggle",
  component: InputToggleDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof InputToggleDoc>;

export const Overview: Story = {};
