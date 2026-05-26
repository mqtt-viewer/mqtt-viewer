import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";

const storybookConfigDir = fileURLToPath(new URL("./.storybook", import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      wailsjs: fileURLToPath(new URL("./wailsjs", import.meta.url)),
    },
  },
  optimizeDeps: {
    include: [
      "@mdx-js/react",
      "gsap/Flip",
      "react",
      "react-dom",
      "react-dom/client",
    ],
    exclude: [
      "codemirror",
      "@codemirror",
      "@codemirror/commands",
      "@codemirror/lang-json",
      "@codemirror/lang-xml",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/merge",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/highlight",
      "@lezer/json",
      "vis-timeline",
      "vis-data",
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.{test,spec}.ts"],
          exclude: ["src/**/*.stories.svelte", "storybook-static/**"],
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: storybookConfigDir,
            tags: { include: ["autodocs"] },
          }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: "playwright",
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
