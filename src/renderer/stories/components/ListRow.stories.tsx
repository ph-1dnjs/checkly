import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, SpecTable } from "./ComponentsUI";
import { componentById, ROWS, STEPS } from "./tokens";

const COMP = componentById("comp-row");

function ListRowDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="DATA ROW" meta="header 30px · row 46px+" />
      <div className="cp-row-block">
        <div className="cp-row-panel">
          <div className="cp-row-header">
            <span>시나리오</span>
            <span style={{ width: 110 }}>마지막 실행</span>
            <span style={{ width: 74, textAlign: "right" }}>단계</span>
            <span style={{ width: 74, textAlign: "right" }}>소요</span>
          </div>
          {ROWS.map((r) => (
            <div className="cp-row-data" key={r.name} style={{ background: r.bg, borderLeftColor: r.bar }}>
              <span className="cp-row-main">
                <span className="cp-row-title-line">
                  <span className={r.running ? "cp-row-dot cp-status-dot--running" : "cp-row-dot"} style={{ background: r.dot }} />
                  <span className="cp-row-title">{r.name}</span>
                  <span className="cp-row-state">{r.linkState}</span>
                </span>
                <span className="cp-row-path">{r.path}</span>
              </span>
              <span className="cp-row-at">{r.at}</span>
              <span className="cp-row-num">{r.steps}</span>
              <span className="cp-row-num">{r.dur}</span>
            </div>
          ))}
        </div>
        <div className="cp-row-caption">1행 default · 2행 hover(#F7F9FA) · 3행 selected(#F5F9FE + 2px #3D8CE0) · 4행 진행 중</div>
      </div>

      <SectionBar label="STEP ROW" meta="30 / 34px · 하위 단계 중첩" />
      <div className="cp-row-block">
        <div className="cp-row-panel">
          {STEPS.map((s) => (
            <div className="cp-step-row" key={s.no} style={{ background: s.bg }}>
              <span className="cp-step-no">{s.no}</span>
              <span className={s.running ? "cp-step-dot cp-status-dot--running" : "cp-step-dot"} style={{ background: s.dot }} />
              <span className="cp-step-op" style={{ background: s.opBg, color: s.opFg }}>
                {s.op}
              </span>
              <span className="cp-step-text" title={s.text}>
                {s.text}
              </span>
              <span className="cp-step-dur">{s.dur}</span>
            </div>
          ))}
          <div className="cp-step-nested">
            <div className="cp-step-nested-row">
              <span className="cp-step-dot" style={{ background: "#0E8A5F" }} />
              입력값 확인
              <span className="cp-step-dur" style={{ marginLeft: "auto" }}>
                0.4s
              </span>
            </div>
            <div className="cp-step-nested-row">
              <span className="cp-step-dot" style={{ background: "#0E8A5F" }} />
              결과 텍스트 비교
              <span className="cp-step-dur" style={{ marginLeft: "auto" }}>
                0.2s
              </span>
            </div>
          </div>
        </div>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof ListRowDoc> = {
  title: "Components/Layout/List Row",
  component: ListRowDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ListRowDoc>;

export const Overview: Story = {};
