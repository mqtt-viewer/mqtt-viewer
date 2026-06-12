import type { Preview } from "@storybook/svelte-vite";
import "../src/custom-preflight.css";
import "../src/style.css";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "App color theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "dark",
  },
  decorators: [
    (story, context) => {
      const theme = context.globals.theme ?? "dark";
      document.documentElement.classList.toggle("light", theme === "light");
      document.documentElement.classList.toggle("dark", theme === "dark");
      return story();
    },
  ],
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "App background",
      values: [
        { name: "App background", value: "var(--color-elevation-0)" },
        { name: "Card", value: "var(--color-elevation-1-card)" },
      ],
    },
    a11y: { test: "todo" },
  },
};

export default preview;
