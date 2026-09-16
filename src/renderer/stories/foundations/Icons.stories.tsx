import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout } from "./FoundationsUI";
import {
  ICON_SIZES,
  ICON_GROUPS,
  ICON_RULES,
  USED_ICON_GROUPS,
  USED_ICON_COUNT,
  USED_ICON_NOT_IN_FOUNDATION,
} from "./tokens";

function UsedIconsSection() {
  return (
    <>
      {USED_ICON_GROUPS.map((g) => (
        <div className="fd-icon-group" key={g.label}>
          <SectionBar label={g.label} meta={g.meta} />
          <div className="fd-icon-grid">
            {g.items.map((it, i) => (
              <div
                className="fd-icon-cell fd-usedicon-cell"
                key={`${it.name}-${i}`}
                title={`${it.name} · ${it.use} · ${it.where}`}
              >
                <span className="msi">{it.name}</span>
                <span className="fd-icon-name">{it.name}</span>
                <span className="fd-icon-label">{it.use}</span>
                <span className="fd-icon-where">{it.where}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Callout
        label="파운데이션 목록 외 사용 중인 아이콘"
        rules={[
          `총 ${USED_ICON_COUNT}개 아이콘이 실제 화면에서 쓰이고 있으며, 이 중 ${USED_ICON_NOT_IN_FOUNDATION.length}개는 위 SIZE 아래의 공식 파운데이션 그룹에는 없습니다.`,
          USED_ICON_NOT_IN_FOUNDATION.join(", "),
        ]}
      />
    </>
  );
}

function IconsDoc() {
  return (
    <Page
      title="Icons"
      desc="Material Symbols Rounded 한 세트만 씁니다. 화살표·재생 표시 같은 단순 도형은 아이콘 대신 CSS border로 만들고, 일러스트와 이모지는 쓰지 않습니다."
    >
      <SectionBar label="SIZE" meta="Material Symbols Rounded · wght 400" />
      <div className="fd-iconsize-grid">
        {ICON_SIZES.map((s) => (
          <div className="fd-iconsize-card" key={s.token}>
            <div className="fd-iconsize-demo">
              <span className="msi" style={{ fontSize: s.value }}>
                play_arrow
              </span>
              <span className="msi" style={{ fontSize: s.value }}>
                edit
              </span>
            </div>
            <div className="fd-iconsize-token">{s.token}</div>
            <div className="fd-iconsize-use">{s.use}</div>
          </div>
        ))}
      </div>

      {ICON_GROUPS.map((g) => (
        <div className="fd-icon-group" key={g.label}>
          <SectionBar label={g.label} meta={g.meta} />
          <div className="fd-icon-grid">
            {g.items.map(([name, label]) => (
              <div className="fd-icon-cell" key={name} title={`${name} · ${label}`}>
                <span className="msi">{name}</span>
                <span className="fd-icon-name">{name}</span>
                <span className="fd-icon-label">{label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <Callout label="RULE" rules={ICON_RULES} warn />

      <div style={{ marginTop: 34 }}>
        <SectionBar label="IN USE" meta={`실제 코드베이스 사용처 · ${USED_ICON_COUNT}개`} />
      </div>
      <UsedIconsSection />
    </Page>
  );
}

const meta: Meta<typeof IconsDoc> = {
  title: "Foundations/Icons",
  component: IconsDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof IconsDoc>;

export const AllIcons: Story = {};

export const Sizes: Story = {
  render: () => (
    <Page title="Icon Size" desc="Material Symbols Rounded · wght 400 기준 크기 토큰.">
      <div className="fd-iconsize-grid">
        {ICON_SIZES.map((s) => (
          <div className="fd-iconsize-card" key={s.token}>
            <div className="fd-iconsize-demo">
              <span className="msi" style={{ fontSize: s.value }}>
                play_arrow
              </span>
              <span className="msi" style={{ fontSize: s.value }}>
                edit
              </span>
            </div>
            <div className="fd-iconsize-token">{s.token}</div>
            <div className="fd-iconsize-use">{s.use}</div>
          </div>
        ))}
      </div>
    </Page>
  ),
};

export const UsedInApp: Story = {
  render: () => (
    <Page
      title="Icons — In Use"
      desc={`src/renderer 전체에서 .msi 클래스로 실제 렌더링되고 있는 아이콘 ${USED_ICON_COUNT}개를 화면(컴포넌트)별로 모았습니다. 새 화면을 만들 때 새 아이콘을 고르기 전에 먼저 이 목록에서 재사용할 수 있는지 확인합니다.`}
    >
      <UsedIconsSection />
    </Page>
  ),
};
