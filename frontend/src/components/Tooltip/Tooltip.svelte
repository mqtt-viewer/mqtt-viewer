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
  // Set this when the slotted content already provides its own tab stop (a
  // button, link, or other focusable element, or when this Tooltip is nested
  // inside an already-focusable ancestor). Skips the wrapper's own tabindex so
  // keyboard users don't hit two stops for one control. The tooltip still
  // opens when the inner element gets focus: focus/blur don't bubble, so this
  // is wired up by hand below via focusin/focusout rather than relying on
  // melt's own trigger focus/blur listeners (which only fire on the exact
  // node use:melt is applied to).
  export let focusable = false;

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

  let openTimeout: ReturnType<typeof setTimeout> | null = null;
  let suppressFocusOpen = false;

  function clearOpenTimeout() {
    if (openTimeout) {
      clearTimeout(openTimeout);
      openTimeout = null;
    }
  }

  function handleFocusIn() {
    if (suppressFocusOpen) return;
    clearOpenTimeout();
    openTimeout = setTimeout(() => open.set(true), openDelay);
  }

  function handleFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    const wrapper = event.currentTarget as Node;
    if (next && wrapper.contains(next)) return;
    clearOpenTimeout();
    suppressFocusOpen = false;
    open.set(false);
  }

  function handlePointerDown() {
    if (!closeOnPointerDown) return;
    suppressFocusOpen = true;
    clearOpenTimeout();
    open.set(false);
  }
</script>

{#if !$$slots["tooltip-content"] && text === ""}
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <slot tabindex="0" />
{:else}
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <div
    id={id + "-trigger"}
    tabindex={focusable ? undefined : 0}
    class={twMerge("focus-visible:ring", className)}
    use:melt={$trigger}
    on:focusin={focusable ? handleFocusIn : undefined}
    on:focusout={focusable ? handleFocusOut : undefined}
    on:pointerdown={focusable ? handlePointerDown : undefined}
  >
    <slot />
  </div>
  {#if $open}
    <div
      id={id + "-content"}
      use:melt={$content}
      transition:fade={{ duration: 100 }}
      class="py-1 px-3 text-emphasis rounded bg-elevation-2 shadow z-[10003]"
    >
      <div use:melt={$arrow} />
      {#if text}
        <span class="">{text}</span>
      {/if}
      <slot name="tooltip-content" />
    </div>
  {/if}
{/if}
