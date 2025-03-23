import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

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
});
