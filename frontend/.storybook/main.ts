import type { StorybookConfig } from "@storybook/svelte-vite";

const config: StorybookConfig = {
  framework: { name: "@storybook/svelte-vite", options: {} },
  stories: ["../src/**/*.stories.@(svelte|ts)"],
  addons: [
    "@storybook/addon-svelte-csf",
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-designs",
    "@storybook/addon-vitest",
  ],
  docs: { autodocs: "tag" },
  staticDirs: [{ from: "../src/assets", to: "/assets" }],
  viteFinal: async (config) => {
    const { mergeConfig } = await import("vite");
    const { fileURLToPath, URL } = await import("node:url");

    return mergeConfig(config, {
      resolve: {
        alias: {
          "@": fileURLToPath(new URL("../src", import.meta.url)),
          wailsjs: fileURLToPath(new URL("./mocks/wailsjs", import.meta.url)),
        },
      },
    });
  },
};

export default config;
