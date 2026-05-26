import type { Preview } from "@storybook/svelte-vite";
import "../src/custom-preflight.css";
import "../src/style.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "App background",
      values: [
        { name: "App background", value: "#020202" },
        { name: "Card", value: "#161616" },
      ],
    },
    a11y: { test: "todo" },
  },
};

export default preview;
