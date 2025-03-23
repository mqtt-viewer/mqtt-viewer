<script lang="ts">
  import Card from "@/components/Card/Card.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import type { IconType } from "@/components/Icon/icons";
  import { twMerge } from "tailwind-merge";

  export let icon: IconType;
  export let iconClass: string = "";
  export let title: string;
  export let text: string;

  export let onClick: () => void;
</script>

<Card {onClick}>
  <div class="flex flex-col gap-2 items-center">
    <div class={twMerge("flex items-center justify-center py-4", iconClass)}>
      <Icon type={icon} size={50} />
    </div>
    <div class="text-lg font-bold text-center">{title}</div>
    <div class="text-secondary-text mt-2 text-center">{text}</div>
  </div>
</Card>
