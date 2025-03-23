<script lang="ts">
  import { getContext } from "svelte";
  import { createDropdownMenu, melt } from "@melt-ui/svelte";
  import { twMerge } from "tailwind-merge";

  export let isSelected = false;
  export let onClick = () => {};
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
    isHovered ? "bg-elevation-2-hover text-white" : "",
    isSelected ? "border-primary border-[1px]" : "",
    className
  )}
  use:melt={$item}
  on:click={onClick}
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
>
  <slot />
</button>
