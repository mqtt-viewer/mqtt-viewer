<script lang="ts">
  import { twMerge } from "tailwind-merge";

  let className = "";
  export { className as class };
</script>

<div
  class={twMerge(
    "bg-elevation-1 text-gray min-h-[50px] overflow-x-hidden max-w-full h-fit",
    className
  )}
>
  <slot />
</div>
