import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page, SectionBar, Callout, SpecTable } from "./ComponentsUI";
import { componentById, SEGMENTED_GROUPS } from "./tokens";

const COMP = componentById("comp-segmented");

function SegmentedDoc() {
  return (
    <Page title={COMP.name} desc={COMP.desc}>
      <SectionBar label="SIZE · STATE" meta="22 / 24 / 28px" />
      {SEGMENTED_GROUPS.map((s) => (
        <div className="cp-seg-row" key={s.token}>
          <span>
            <span className="cp-seg-row-token">{s.token}</span>
            <span className="cp-seg-row-use">{s.use}</span>
          </span>
          <span>
            <span className="cp-seg" style={{ height: s.h }}>
              {s.items.map((name, i) => (
                <span
                  key={name}
                  className={i === s.activeIndex ? "cp-seg-item cp-seg-item--active" : "cp-seg-item"}
                  style={{ fontSize: s.fs }}
                >
                  {name}
                </span>
              ))}
            </span>
          </span>
        </div>
      ))}

      <SectionBar label="IN CONTEXT" meta="패널 헤더 바 안" />
      <div className="cp-seg-context">
        <div className="cp-seg-context-panel">
          <div className="cp-seg-context-bar">
            VIEWPORT
            <span style={{ marginLeft: "auto" }} className="cp-seg">
              <span className="cp-seg-item cp-seg-item--active" style={{ fontSize: 11 }}>
                1440
              </span>
              <span className="cp-seg-item" style={{ fontSize: 11 }}>
                768
              </span>
              <span className="cp-seg-item" style={{ fontSize: 11 }}>
                390
              </span>
            </span>
          </div>
          <div className="cp-seg-context-body">capture area</div>
        </div>
      </div>

      <SectionBar label="SPEC" meta="token · value" />
      <SpecTable rows={COMP.specs} />
      <Callout label="USAGE" rules={COMP.rules} />
    </Page>
  );
}

const meta: Meta<typeof SegmentedDoc> = {
  title: "Components/Controls/Segmented",
  component: SegmentedDoc,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof SegmentedDoc>;

export const Overview: Story = {};
