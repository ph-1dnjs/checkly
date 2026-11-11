import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, Icon, SpecTable } from "./ComponentsUI";
import { componentById } from "./tokens";
import { Button, type ButtonVariant } from "../../shared/ui/Button";
import type { ControlSize } from "../../shared/ui/control";

const COMP = componentById("comp-button");
const VARIANTS: Array<[ButtonVariant, string]> = [
  ["primary", "주 CTA"],
  ["secondary", "보조 동작"],
  ["danger", "삭제·중지"],
  ["ghost", "아이콘·툴바 동작"],
];
const SIZES: ControlSize[] = ["large", "small"];

function ButtonDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      {SIZES.map((size) => (
        <div key={size}>
          <SectionBar label={`SIZE · ${size.toUpperCase()}`} meta={size === "large" ? "44px" : "32px"} />
          <div style={{ display: "grid", gap: 12, padding: "16px 0" }}>
            {VARIANTS.map(([variant, use]) => (
              <div key={variant} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 90, color: "#8A939C", fontSize: 11 }}>{variant}</span>
                <Button variant={variant} size={size}>로그인</Button>
                <Button variant={variant} size={size}>
                  <Icon name="play_arrow" size={size === "large" ? 18 : 16} />
                  실행
                </Button>
                <Button variant={variant} size={size} iconOnly aria-label="복제">
                  <Icon name="content_copy" size={size === "large" ? 18 : 16} />
                </Button>
                <Button variant={variant} size={size} disabled>비활성</Button>
                <span style={{ color: "#8A939C", fontSize: 11 }}>{use}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

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

/** 변형 4종 × 크기 2종. 문서 장식 없이 실제 컴포넌트만 렌더한다. */
export const Variants: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, padding: 16 }}>
      {SIZES.map((size) => (
        <div key={size} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {VARIANTS.map(([variant]) => (
            <Button key={variant} variant={variant} size={size}>
              {variant === "danger" ? "삭제" : variant === "primary" ? "저장" : "취소"}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** 아이콘+텍스트, 아이콘 전용, 비활성 상태 */
export const IconAndDisabled: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16 }}>
      <Button variant="primary">
        <Icon name="play_arrow" size={16} />
        실행
      </Button>
      <Button variant="ghost" iconOnly aria-label="복제">
        <Icon name="content_copy" size={16} />
      </Button>
      <Button variant="secondary" disabled>비활성</Button>
      <Button variant="primary" disabled>비활성</Button>
    </div>
  ),
};
