import type { Preview } from "@storybook/react-vite";
import "../src/renderer/styles/foundations.css";
import "../src/renderer/styles/components.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "canvas",
      values: [{ name: "canvas", value: "#FFFFFF" }],
    },
    options: {
      storySort: {
        order: [
          "Foundations",
          ["Typography", "Color", "Dimensions", "Effects", "Icons"],
          "Components",
          [
            "Controls",
            ["Button", "Segmented", "Input · Toggle"],
            "Display",
            ["Badge · Tag", "Status", "Progress"],
            "Layout",
            ["List Row", "Panel Header"],
            "Feedback",
            ["Callout", "Toast", "Modal", "Drawer"],
            "Navigation",
            ["Dock · Console"],
          ],
        ],
      },
    },
  },
};

export default preview;
