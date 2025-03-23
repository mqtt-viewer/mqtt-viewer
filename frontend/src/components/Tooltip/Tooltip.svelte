<script lang="ts">
  import { createTooltip, melt } from "@melt-ui/svelte";
  import { fade } from "svelte/transition";
  import { twMerge } from "tailwind-merge";
  import type { Placement } from "./placement";

  let className = "";
  export { className as class };
  export let placement: Placement = undefined;

  export let text = "";
  export let openDelay = 600;
  export let forceOpen = false;
  export let closeOnPointerDown = true;

  $: forceOpen,
    (() => {
      if (forceOpen) {
        open.set(true);
      } else {
        open.set(false);
      }
    })();

  const {
    elements: { trigger, content, arrow },
    states: { open },
  } = createTooltip({
    positioning: {
      placement,
    },
    openDelay,
    closeDelay: 0,
    closeOnPointerDown,
    forceVisible: true,
  });

  const id = Math.random().toString(36);
</script>

{#if !$$slots["tooltip-content"] && text === ""}
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <slot tabindex="0" />
{:else}
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <div
    id={id + "-trigger"}
    tabindex="0"
    class={twMerge("focus-visible:ring", className)}
    use:melt={$trigger}
  >
    <slot />
  </div>
  {#if $open}
    <div
      id={id + "-content"}
      use:melt={$content}
      transition:fade={{ duration: 100 }}
      class="py-1 px-3 text-white rounded bg-elevation-2 shadow z-[10003]"
    >
      <div use:melt={$arrow} />
      {#if text}
        <span class="">{text}</span>
      {/if}
      <slot name="tooltip-content" />
    </div>
  {/if}
{/if}
