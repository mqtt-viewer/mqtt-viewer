import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";

const storybookConfigDir = fileURLToPath(
  new URL("./.storybook", import.meta.url)
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Relative asset base so the built index.html references ./assets/* rather
  // than /assets/*. That lets a reverse proxy serve the app under a path prefix
  // (Home Assistant ingress) without the asset URLs escaping to the origin
  // root. Server mode and the desktop webview both load at "/", where "./"
  // resolves identically to "/", so nothing changes for them.
  base: "./",
  // The Wails dev proxy (ExternalAssetHandler) dials the frontend dev server
  // over IPv4 (`tcp4 127.0.0.1:<port>`). Vite's default `localhost` host can
  // resolve to IPv6 `::1` only, leaving the proxy with a permanent
  // "connection refused" and a blank webview. Pin the dev server to IPv4 so
  // `wails3 dev` can always reach it.
  server: {
    host: "127.0.0.1",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      bindings: fileURLToPath(new URL("./bindings", import.meta.url)),
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
          exclude: [
            "src/**/*.stories.svelte",
            "src/**/*.perf.test.ts",
            "storybook-static/**",
          ],
        },
      },
      // Wall-clock perf budgets. They share no CPU with the rest of the run:
      // groupOrder 1 starts this project only after the unit project
      // finishes, and fileParallelism: false runs its files one at a time.
      // The retry covers contention from outside the run (other agents'
      // suites on the same machine); a real regression fails every attempt.
      // Budgets live in the test files and are not loosened here.
      {
        extends: true,
        test: {
          name: "perf",
          include: ["src/**/*.perf.test.ts"],
          fileParallelism: false,
          retry: 2,
          sequence: { groupOrder: 1 },
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
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
