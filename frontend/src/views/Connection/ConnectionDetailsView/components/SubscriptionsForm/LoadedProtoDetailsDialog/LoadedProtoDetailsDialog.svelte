<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import { createTreeView } from "@melt-ui/svelte";
  import { buildTreeData } from "./LoadedProtoTree/build-tree-data";
  import { writable } from "svelte/store";
  import { setContext } from "svelte";
  import LoadedProtoTree from "./LoadedProtoTree/LoadedProtoTree.svelte";
  import ProtobufLogo from "@/components/ProtobufLogo/ProtobufLogo.svelte";

  export let open = writable(false);
  export let loadedRootDir: string;
  export let loadedProtoFilesWithDescriptorsMap: {
    [filePath: string]: string[];
  };
  export let selectedDescriptor = undefined as string | undefined;
  export let selectedDescriptorIsMissing = false;
  export let onDescriptorSelect = undefined as
    | ((descriptor: string) => void)
    | undefined;

  $: treeData = buildTreeData({
    loadedRootDir,
    loadedProtoFilesWithDescriptorsMap,
  });

  $: expandedItems = writable(treeData.expandableIds);

  const ctx = createTreeView({
    expanded: expandedItems,
  });
  setContext("tree", ctx);

  const {
    elements: { tree },
  } = ctx;
</script>

<Dialog
  isOpen={open}
  title="Loaded Protobuf Details"
  description={`Showing all descriptors found inside ${loadedRootDir}`}
>
  <slot slot="trigger" name="trigger" />
  {#if !!onDescriptorSelect}
    <span
      class={`${
        selectedDescriptorIsMissing ? "text-error" : "text-secondary-text"
      } flex items-center`}
      >Selected descriptor:
      {#if !!selectedDescriptor}
        <span class="inline-block size-[16px] ml-3 mr-1 mt-[2px]"
          ><ProtobufLogo isActive /></span
        >
      {/if}
      {#if !!selectedDescriptor}
        {selectedDescriptor}{selectedDescriptorIsMissing ? " (missing)" : ""}
      {:else}
        No descriptor selected
      {/if}
    </span>
  {/if}
  <div class="w-[600px] h-[45vh] mt-4">
    <ul
      class="h-full overflow-auto py-4 px-1 border border-divider rounded"
      {...$tree}
    >
      <LoadedProtoTree
        treeItems={treeData.items}
        {onDescriptorSelect}
        {selectedDescriptor}
      />
    </ul>
  </div>
</Dialog>
