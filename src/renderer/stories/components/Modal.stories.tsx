import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, SpecTable } from "./ComponentsUI";
import { componentById } from "./tokens";

const COMP = componentById("comp-modal");

function ModalDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="MODAL" meta="460px · radius 6px · overlay .24" />
      <div className="cp-modal-stage cp-stage-vert">
        <div className="cp-modal-overlay" />
        <div className="cp-modal" role="dialog">
          <div className="cp-modal-title">시나리오를 삭제할까요?</div>
          <div className="cp-modal-body">로그인 후 대시보드 확인 시나리오와 지난 24회의 실행 기록이 함께 삭제됩니다. 되돌릴 수 없습니다.</div>
          <div className="cp-modal-mono">scenarios/login-dashboard.md</div>
          <div className="cp-modal-actions">
            <span className="cp-modal-btn cp-modal-btn--cancel">취소</span>
            <span className="cp-modal-btn cp-modal-btn--danger">삭제</span>
          </div>
        </div>
      </div>
      <div className="cp-modal-caption" style={{ padding: "0 12px 20px" }}>
        액션은 우측 정렬 gap 6px · 파괴적 동작은 danger 버튼 하나만
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof ModalDoc> = {
  title: "Components/Feedback/Modal",
  component: ModalDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ModalDoc>;

export const Overview: Story = {};
