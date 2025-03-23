<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import Icon from "../Icon/Icon.svelte";

  export let disabled = false;
  export let text: string;
  export let onClick = () => {};
  let className = "";
  export { className as class };
  export let size = "medium" as "small" | "medium";
</script>

<button
  {disabled}
  class={twMerge(
    `w-full border-[1px] border-dashed border-secondary-text text-secondary-text
    hover:border-white hover:text-white
    transition-colors rounded py-2 flex items-center justify-center`,
    size === "small" ? "py-1.5 text-sm" : "py-2 text-base",
    className,
    disabled
      ? "opacity-60 cursor-not-allowed pointer-events-none"
      : "cursor-pointer"
  )}
  on:click={onClick}
>
  <div class="flex items-center gap-1">
    <Icon type="plus" size={size === "small" ? 12 : 14} />
    <span>{text}</span>
  </div>
</button>
