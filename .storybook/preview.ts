import type { Preview } from "@storybook/react-vite";
import "../src/renderer/styles/foundations.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "canvas",
      values: [{ name: "canvas", value: "#FFFFFF" }],
    },
    options: {
      storySort: {
        order: ["Foundations", ["Typography", "Color", "Dimensions", "Effects", "Icons"]],
      },
    },
  },
};

export default preview;
