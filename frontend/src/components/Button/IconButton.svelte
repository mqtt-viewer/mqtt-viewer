<script lang="ts">
  import { onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import Button from "./Button.svelte";
  import Tooltip from "../Tooltip/Tooltip.svelte";
  import { twMerge } from "tailwind-merge";
  import type { Placement } from "../Tooltip/placement";

  export let disabled = false;
  export let tooltipText = "";
  export let tooltipPlacement: Placement = undefined;
  export let onClick = (e: MouseEvent) => {};
  export let tooltipOpenDelay = 500;
  export let feedbackText = undefined as string | undefined;
  export let preventFocus = false;
  let className = "";
  export { className as class };

  let clicked = false;
  let clickTimeout: NodeJS.Timeout | null = null;

  $: click = (e: MouseEvent) => {
    if (!!onClick) {
      onClick(e);
    }
    clicked = true;
    if (!!clickTimeout) {
      clearTimeout(clickTimeout);
    }
    clickTimeout = setTimeout(() => {
      clicked = false;
      clickTimeout = null;
    }, 2000);
  };

  onDestroy(() => {
    clicked = false;
    if (!!clickTimeout) {
      clearTimeout(clickTimeout);
    }
  });
</script>

{#if tooltipText || feedbackText}
  <Tooltip
    openDelay={clicked ? 0 : tooltipOpenDelay}
    forceOpen={clicked}
    placement={tooltipPlacement}
  >
    <span slot="tooltip-content"
      >{clicked ? (feedbackText ?? tooltipText) : tooltipText}</span
    >
    <div
      class={twMerge(
        "hover:bg-hovered p-[3px] rounded group cursor-pointer",
        className,
        disabled ? "opacity-40 hover:bg-inherit cursor-default" : ""
      )}
    >
      <Button variant="text" on:click={click} {disabled}>
        {#if $$slots["feedback-icon"]}
          {#if clicked}
            <div in:fly={{ y: 4 }}>
              <slot name="feedback-icon" />
            </div>
          {:else}
            <div in:fly={{ y: -4 }}>
              <slot name="icon" />
              <slot />
            </div>
          {/if}
        {:else}
          <slot name="icon" />
          <slot />
        {/if}
      </Button>
    </div>
  </Tooltip>
{:else}
  <div
    class={twMerge(
      "hover:bg-hovered p-[3px] rounded group cursor-pointer",
      className,
      disabled ? "opacity-60 hover:bg-inherit cursor-default" : ""
    )}
  >
    <Button variant="text" on:click={click} {disabled} preventFocus>
      {#if $$slots["feedback-icon"]}
        {#if clicked}
          <div in:fly={{ y: 4 }}>
            <slot name="feedback-icon" />
          </div>
        {:else}
          <div in:fly={{ y: -4 }}>
            <slot name="icon" />
            <slot />
          </div>
        {/if}
      {:else}
        <slot name="icon" />
        <slot />
      {/if}
    </Button>
  </div>
{/if}
