import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, SpecTable } from "./ComponentsUI";
import { componentById, HISTORY, TAPE } from "./tokens";

const COMP = componentById("comp-progress");
const passCount = HISTORY.filter((h) => h.color === "#0E8A5F").length;
const failCount = HISTORY.filter((h) => h.color === "#DE3B45").length;

function ProgressDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="HISTORY STRIP" meta="34px · gap 3px" />
      <div className="cp-progress-block">
        <div className="cp-history-strip">
          {HISTORY.map((h, i) => (
            <span key={i} title={h.title} className="cp-history-bar" style={{ background: h.color, height: h.h }} />
          ))}
        </div>
        <div className="cp-history-caption">
          <span>최근 {HISTORY.length}회</span>
          <span>
            통과 {passCount} · 실패 {failCount}
          </span>
        </div>
      </div>

      <SectionBar label="RUN TAPE" meta="3px · 단계 수만큼 등분" />
      <div className="cp-progress-block">
        <div className="cp-tape-strip">
          {TAPE.map((t, i) => (
            <span key={i} className={t.running ? "cp-tape-seg cp-tape-seg--running" : "cp-tape-seg"} style={{ background: t.color }} />
          ))}
        </div>
        <div className="cp-tape-strip cp-tape-strip--report">
          {TAPE.map((t, i) => (
            <span key={i} className="cp-tape-seg" style={{ background: t.color }} />
          ))}
        </div>
        <div className="cp-progress-caption">위: 실행 화면 3px · 아래: 리포트 6px / gap 3px</div>
      </div>

      <SectionBar label="DONUT · INDETERMINATE" meta="38px · ckBar" />
      <div className="cp-progress-block cp-progress-row">
        <div className="cp-donut-wrap">
          <span className="cp-donut" style={{ background: "conic-gradient(#3D8CE0 0 62%, #EDF0F2 62% 100%)" }}>
            <span className="cp-donut-inner">62%</span>
          </span>
          <span className="cp-toggle-caption">comp/progress-donut</span>
        </div>
        <div className="cp-indeterminate-wrap">
          <span className="cp-indeterminate-track">
            <span className="cp-indeterminate-bar" />
          </span>
          <span className="cp-toggle-caption" style={{ display: "block", marginTop: 8 }}>
            comp/progress-indeterminate
          </span>
        </div>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof ProgressDoc> = {
  title: "Components/Display/Progress",
  component: ProgressDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ProgressDoc>;

export const Overview: Story = {};
