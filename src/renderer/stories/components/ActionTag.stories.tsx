import type { Meta, StoryObj } from "@storybook/react-vite";
import "../../styles/index.css";
import { ActionTag } from "../../shared/ui/ActionTag";
import { ACTIONS } from "../../shared/model/action";

const meta: Meta<typeof ActionTag> = {
  title: "Components/Display/Action Tag",
  component: ActionTag,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof ActionTag>;

/** 시나리오 단계의 액션 종류를 86px 고정 폭 태그로 보여 준다. */
export const AllActions: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, max-content)", gap: 10 }}>
      {ACTIONS.map((action) => (
        <ActionTag key={action} action={action} />
      ))}
    </div>
  ),
};

/** 편집 화면의 단계 행처럼 대상 텍스트 앞에 붙여 쓴다. */
export const InStepRow: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 8, width: 420 }}>
      {([
        ["goto", "https://staging.checkly.dev/login"],
        ["fill", "이메일 입력란"],
        ["click", "로그인 버튼"],
        ["expectText", "대시보드"],
      ] as const).map(([action, target]) => (
        <div key={target} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#3d4650" }}>
          <ActionTag action={action} />
          <span>{target}</span>
        </div>
      ))}
    </div>
  ),
};
