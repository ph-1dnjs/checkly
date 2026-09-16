import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, Icon, SpecTable } from "./ComponentsUI";
import { componentById } from "./tokens";

const COMP = componentById("comp-toast");

function ToastDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="TOAST" meta="340px · right 20px / bottom 92px" />
      <div className="cp-toast-stage cp-stage-diag">
        <div className="cp-toast-row">
          <div className="cp-toast" role="status">
            <span className="cp-donut" style={{ background: "conic-gradient(#3D8CE0 0 42%, #EDF0F2 42% 100%)" }}>
              <span className="cp-donut-inner">42%</span>
            </span>
            <span className="cp-toast-text">
              <span className="cp-toast-title">로그인 시나리오 실행 중</span>
              <span className="cp-toast-meta">단계 5 / 12 · 00:06.400</span>
            </span>
            <span className="cp-toast-close">
              <Icon name="close" size={16} color="#A6AEB5" />
            </span>
          </div>
          <div className="cp-toast" role="status">
            <span className="cp-row-dot" style={{ background: "#0E8A5F" }} />
            <span className="cp-toast-text">
              <span className="cp-toast-title">12개 단계 모두 통과</span>
              <span className="cp-toast-meta">00:14.280</span>
            </span>
            <span className="cp-toast-action">리포트</span>
          </div>
        </div>
        <div className="cp-progress-caption">실행 중(진행률 도넛) · 완료(상태 점 + 링크)</div>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof ToastDoc> = {
  title: "Components/Feedback/Toast",
  component: ToastDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ToastDoc>;

export const Overview: Story = {};
