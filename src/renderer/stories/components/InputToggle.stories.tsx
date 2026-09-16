import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, Icon, SpecTable } from "./ComponentsUI";
import { componentById, INPUTS } from "./tokens";

const COMP = componentById("comp-form");

function InputToggleDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="TEXT INPUT" meta="26 / 30px" />
      <div className="cp-input-grid">
        {INPUTS.map((i) => (
          <div className="cp-input-cell" key={i.token}>
            <div className="cp-input-token">{i.token}</div>
            <div className="cp-input-box" style={{ borderColor: i.border, background: i.bg, height: i.h }}>
              {i.icon && <Icon name={i.icon} size={14} color="#A6AEB5" />}
              <span
                className="cp-input-value"
                style={{ fontFamily: i.family === "mono" ? "var(--ck-font-mono)" : "var(--ck-font-ui)", fontSize: i.fs, color: i.fg }}
              >
                {i.value}
              </span>
              {i.suffix && <span className="cp-input-suffix">{i.suffix}</span>}
            </div>
            <div className="cp-input-use">{i.use}</div>
          </div>
        ))}
      </div>

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
