<script context="module" lang="ts">
  export type TreeItem = {
    id: string;
    title: string;
    type: TreeIconType;
    children?: TreeItem[];
  };
</script>

<script lang="ts">
  import { melt, type TreeView } from "@melt-ui/svelte";
  import type { TreeIconType } from "./LoadedProtoTreeItem.svelte";
  import { getContext } from "svelte";
  import LoadedProtoTreeItem from "./LoadedProtoTreeItem.svelte";

  export let treeItems: TreeItem[];
  export let level = 1;
  export let selectedDescriptor = undefined as string | undefined;
  export let onDescriptorSelect = undefined as
    | ((descriptor: string) => void)
    | undefined;

  const {
    elements: { item, group },
    helpers: { isExpanded, isSelected },
  } = getContext<TreeView>("tree");
</script>

{#each treeItems as treeItem}
  {@const hasChildren = !!treeItem.children?.length}
  {@const expanded = $isExpanded(treeItem.id)}
  {@const allowPress = hasChildren || !!onDescriptorSelect}
  <li class={level !== 1 ? "pl-4" : ""}>
    <button
      class="flex items-center gap-1 rounded-md p-1 focus:bg-magnum-200"
      use:melt={$item({
        id: treeItem.id,
        hasChildren,
      })}
      on:click={() => {
        if (treeItem.type === "descriptor" && !!onDescriptorSelect) {
          onDescriptorSelect(treeItem.title);
        }
      }}
    >
      <LoadedProtoTreeItem
        {allowPress}
        isExpanded={expanded}
        name={treeItem.title}
        iconType={treeItem.type}
        isSelected={treeItem.type === "descriptor" &&
          treeItem.title === selectedDescriptor}
      />
    </button>

    {#if treeItem.children}
      <ul use:melt={$group({ id: treeItem.id })}>
        <svelte:self
          {selectedDescriptor}
          treeItems={treeItem.children}
          level={level + 1}
          {onDescriptorSelect}
        />
      </ul>
    {/if}
  </li>
{/each}
