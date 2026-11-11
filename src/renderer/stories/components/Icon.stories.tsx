import type { Meta, StoryObj } from "@storybook/react-vite";
import "../../styles/index.css";
import { Icon, type IconName } from "../../shared/ui/Icon";

const NAMES: IconName[] = [
  "add", "add_link", "arrow_back", "auto_fix_high", "check", "check_circle", "close", "content_copy",
  "data_object", "delete", "download", "drag_indicator", "dynamic_form", "edit", "error", "expand_more",
  "folder", "info", "link", "more_horiz", "play_arrow", "play_circle", "playlist_play", "refresh",
  "save", "settings", "stop_circle", "unfold_less", "unfold_more", "warning",
];

const meta: Meta<typeof Icon> = {
  title: "Components/Display/Icon",
  component: Icon,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof Icon>;

/** 앱에 내장된 SVG 아이콘 전체. 색은 currentColor를 따른다. */
export const AllIcons: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 96px)", gap: 8, color: "#3d4650" }}>
      {NAMES.map((name) => (
        <div key={name} style={{ display: "grid", justifyItems: "center", gap: 6, padding: "10px 4px", border: "1px solid #e5e8eb", borderRadius: 6 }}>
          <Icon name={name} size={20} />
          <span style={{ fontSize: 10, color: "#8a939c" }}>{name}</span>
        </div>
      ))}
    </div>
  ),
};

/** 크기는 size(px)로, 색은 부모 color로 정한다. */
export const SizesAndColor: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      {[14, 16, 18, 24].map((size) => (
        <span key={size} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#3d4650" }}>
          <Icon name="play_circle" size={size} />
          {size}px
        </span>
      ))}
      <span style={{ color: "#1f63ae" }}><Icon name="check_circle" size={20} /></span>
      <span style={{ color: "#c2410c" }}><Icon name="warning" size={20} /></span>
      <span style={{ color: "#b42318" }}><Icon name="error" size={20} /></span>
    </div>
  ),
};
