<script lang="ts">
  import type { ConnectionState } from "@/stores/connections";
  import { twMerge } from "tailwind-merge";

  export let state: ConnectionState;
  let className = "";
  export { className as class };
</script>

<div
  class={twMerge(
    `min-h-2 min-w-2 rounded-full animate-pulse
  ${state === "connected" ? "bg-success" : ""}
  ${state === "connecting" ? "bg-warning" : ""}
  ${state === "reconnecting" ? "bg-warning" : ""}
  ${state === "disconnected" ? "bg-error" : ""}
`,
    className
  )}
/>
