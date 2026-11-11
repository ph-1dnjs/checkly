import type { Meta, StoryObj } from "@storybook/react-vite";
import "../../styles/index.css";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";

const noop = () => {};

const meta: Meta<typeof Modal> = {
  title: "Components/Feedback/Modal Dialog",
  component: Modal,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Modal>;

/** 파괴적 동작 확인. 액션은 우측 정렬, danger 버튼은 하나만 둔다. */
export const ConfirmDelete: Story = {
  render: () => (
    <div style={{ height: 420 }}>
      <Modal label="시나리오 삭제" backdropClassName="modal-backdrop" className="manual-modal" onClose={noop}>
        <h2>시나리오 삭제</h2>
        <p>“로그인 후 대시보드 확인”을 팀 DB에서 삭제하시겠습니까?</p>
        <div className="modal-actions">
          <Button variant="secondary">취소</Button>
          <Button variant="danger">삭제</Button>
        </div>
      </Modal>
    </div>
  ),
};

/** 입력을 받는 모달. 라벨 안에 Input을 둔다. */
export const WithForm: Story = {
  render: () => (
    <div style={{ height: 460 }}>
      <Modal label="시나리오 이름 바꾸기" backdropClassName="modal-backdrop" className="manual-modal" onClose={noop}>
        <h2>시나리오 이름 바꾸기</h2>
        <p>팀원에게 보이는 이름입니다.</p>
        <label>
          시나리오 이름
          <Input defaultValue="로그인 후 대시보드 확인" />
        </label>
        <div className="modal-actions">
          <Button variant="secondary">취소</Button>
          <Button variant="primary">저장</Button>
        </div>
      </Modal>
    </div>
  ),
};
