<script lang="ts">
  import { getContext } from "svelte";
  import { createDropdownMenu, melt } from "@melt-ui/svelte";
  import { twMerge } from "tailwind-merge";
  import Icon from "../Icon/Icon.svelte";
  import type { IconType } from "../Icon/icons";

  export let isSelected = false;
  export let onClick = () => {};
  // Optional leading icon. Items without one keep their plain text layout.
  export let iconType: IconType | undefined = undefined;
  let className = "";
  export { className as class };

  let isHovered = false;
  const onMouseEnter = () => (isHovered = true);
  const onMouseLeave = () => (isHovered = false);

  const elements = getContext("menu-elements") as ReturnType<
    typeof createDropdownMenu
  >["elements"];
  const { item } = elements;
</script>

<button
  class={twMerge(
    "relative text-left cursor-pointer rounded py-[6px] px-2 text-white-text focus:z-10",
    iconType ? "flex items-center gap-2" : "",
    isHovered ? "bg-elevation-2-hover text-emphasis" : "",
    isSelected ? "border-primary border-[1px]" : "",
    className
  )}
  use:melt={$item}
  on:click={onClick}
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
>
  {#if iconType}
    <span class="w-4 shrink-0 flex items-center justify-center">
      <Icon type={iconType} size={14} />
    </span>
  {/if}
  <slot />
</button>
