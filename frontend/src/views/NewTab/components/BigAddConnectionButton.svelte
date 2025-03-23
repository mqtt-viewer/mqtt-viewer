<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import Icon from "@/components/Icon/Icon.svelte";
  import Button from "@/components/Button/Button.svelte";

  export let onClick: () => void;
  let className = "";
  export { className as class };
</script>

<Button class={twMerge("w-full h-[170px]", className)} on:click={onClick}>
  <div class="w-full h-full flex flex-col justify-center items-center">
    <Icon type="plus" size={24} />
    <div class="text-xl mt-4">Create New Connection</div>
  </div>
</Button>
