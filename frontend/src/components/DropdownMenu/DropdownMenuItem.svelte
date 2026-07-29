<script lang="ts">
  import { getContext } from "svelte";
  import { createDropdownMenu, melt } from "@melt-ui/svelte";
  import { twMerge } from "tailwind-merge";

  export let isSelected = false;
  export let onClick = () => {};
  // Genuinely disables the item, rather than just dimming it: melt reads
  // `aria-disabled`/`data-disabled` live off the DOM (see
  // isElementDisabled in @melt-ui/svelte/dist/builders/menu/create.js) on
  // pointerdown, click and pointermove, and its arrow-key navigation skips
  // any item carrying `data-disabled`. A caller that only faked this with
  // an opacity class left the item focusable, Enter-activatable, and
  // closing the menu - dimming an item is not disabling it.
  export let disabled = false;
  let className = "";
  export { className as class };

  let isHovered = false;
  const onMouseEnter = () => {
    if (disabled) return;
    isHovered = true;
  };
  const onMouseLeave = () => (isHovered = false);
  const handleClick = () => {
    if (disabled) return;
    onClick();
  };

  const elements = getContext("menu-elements") as ReturnType<
    typeof createDropdownMenu
  >["elements"];
  const { item } = elements;
</script>

<button
  {disabled}
  aria-disabled={disabled ? "true" : undefined}
  data-disabled={disabled ? "" : undefined}
  class={twMerge(
    "relative text-left cursor-pointer rounded py-[6px] px-2 text-white-text focus:z-10",
    isHovered ? "bg-elevation-2-hover text-emphasis" : "",
    isSelected ? "border-primary border-[1px]" : "",
    disabled ? "cursor-default opacity-50 text-secondary-text" : "",
    className
  )}
  use:melt={$item}
  on:click={handleClick}
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
>
  <slot />
</button>
