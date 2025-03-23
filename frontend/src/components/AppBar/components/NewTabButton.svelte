<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import Icon from "@/components/Icon/Icon.svelte";

  export let isSelected = false;
  export let newTabButtonWidth: number;
  export let onClick: () => void;
</script>

<button
  class={twMerge(
    "relative h-full flex items-center justify-center transition-[width,_color,_opacity]",
    isSelected ? "bg-elevation-1 opacity-100" : "opacity-70",
    "hover:opacity-100 overflow-hidden"
  )}
  style:width={isSelected ? "120px" : "38px"}
  on:click={onClick}
  bind:clientWidth={newTabButtonWidth}
>
  <span
    class={twMerge(
      "text-white/100 absolute w-fit whitespace-nowrap overflow-hidden",
      "transition-[opacity,_width] duration-150 delay-[75ms]",
      "top-1/2 left-[16px] -translate-y-1/2"
    )}
    style:opacity={isSelected ? "1" : "0"}>New Tab</span
  >
  <div
    class={twMerge(
      "absolute top-1/2 right-[4px] -translate-x-1/2 -translate-y-1/2",
      "transition-[transform,_color] duration-150 delay-[75ms]",
      isSelected && "rotate-45",
      "hover:text-white-text"
    )}
  >
    <Icon type="plus" weight="bold" size={17} />
  </div>
</button>
