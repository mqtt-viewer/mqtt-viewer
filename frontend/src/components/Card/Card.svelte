<script lang="ts">
  import { twMerge } from "tailwind-merge";

  let className = "";
  export { className as class };

  export let onClick: (() => void) | null = null;

  $: isButton = !!onClick;
</script>

{#if isButton}
  <button
    class={twMerge(
      "bg-button/50 p-4 rounded hover:bg-hovered/50",
      "transition-colors duration-200 cursor-pointer",
      className
    )}
    on:click={onClick}
  >
    <slot />
  </button>
{:else}
  <div class={twMerge("bg-elevation-1-card p-4 rounded", className)}>
    <slot />
  </div>
{/if}
