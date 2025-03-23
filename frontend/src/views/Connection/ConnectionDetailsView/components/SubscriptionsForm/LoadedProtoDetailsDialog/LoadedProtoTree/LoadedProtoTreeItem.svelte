<script context="module" lang="ts">
  export type TreeIconType = "folder" | "descriptor" | "file";
</script>

<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import ProtobufLogo from "@/components/ProtobufLogo/ProtobufLogo.svelte";

  export let allowPress: boolean;
  export let isExpanded: boolean;
  export let isSelected: boolean;
  export let name: string;
  export let iconType: TreeIconType;

  const getIconType = (iconType: TreeIconType, isExpanded: boolean) => {
    switch (iconType) {
      case "folder":
        return isExpanded ? "folderOpen" : "folder";
      case "file":
        return isExpanded ? "fileOpen" : "file";
      default:
        return iconType;
    }
  };

  $: icon = getIconType(iconType, isExpanded) as TreeIconType;
</script>

<div
  class={`h-[30px] flex py-1 px-[8px] items-center gap-2 rounded-sm
  text-secondary-text
  ${allowPress ? "hover:text-white" : "cursor-auto"}
  transition-colors ${
    isSelected ? "border border-primary px-[8px]" : "px-[9px]"
  }`}
>
  {#if icon === "descriptor"}
    <span class="size-[18px]">
      <ProtobufLogo isActive />
    </span>
  {:else}
    <Icon type={icon} size={16} />
  {/if}
  {name}
  {#if icon !== "descriptor"}
    <span
      class={`-ml-1 mt-[2px] transition-transform ${
        isExpanded ? "rotate-0" : "-rotate-90"
      }`}
    >
      <Icon type="down" size={16} />
    </span>
  {/if}
</div>
