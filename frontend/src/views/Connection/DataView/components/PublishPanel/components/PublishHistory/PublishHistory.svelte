<script lang="ts">
  import IconButton from "@/components/Button/IconButton.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import { get, writable } from "svelte/store";
  import { getConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import { createPublishHistoryStore } from "../../stores/publish-history";
  import PublishHistoryItem from "./PublishHistoryItem.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import { untypedColors } from "@/util/resolvedTailwindConfig";
  // @ts-ignore
  import VirtualList from "@sveltejs/svelte-virtual-list/VirtualList.svelte";
  import type { models } from "wailsjs/go/models";
  import { addToast } from "@/components/Toast/Toast.svelte";

  export let publishHistoryStore: ReturnType<typeof createPublishHistoryStore>;

  const fieldColor = untypedColors["outline"]["DEFAULT"];
  const fieldHoverColor = untypedColors["hovered"]["DEFAULT"];

  let connectionId = getConnectionIdContext();

  $: hasHistory = $publishHistoryStore.publishHistory.length > 0;

  let searchText = "";
  $: filteredHistory = $publishHistoryStore.publishHistory.filter((item) => {
    return (
      searchText === "" ||
      item.topic.includes(searchText) ||
      item.payload.includes(searchText) ||
      item.format.includes(searchText)
    );
  });

  let isOpen = writable(false);

  const onItemClick = (item: models.PublishHistory) => {
    publishHistoryStore.setPublishDetailsFromHistoryEntry(item);
    $isOpen = false;
  };

  const onCrossClick = async (id: number) => {
    try {
      await publishHistoryStore.deletePublishEntry(id);
      const newHistoryLen = get(publishHistoryStore).publishHistory.length;
      if (newHistoryLen === 0) {
        $isOpen = false;
      }
    } catch (e) {
      addToast({
        data: {
          title: "Remove failed",
          description: `${e}`,
          type: "error",
        },
      });
    }
  };
</script>

{#if hasHistory}
  <Dialog {isOpen} startEmpty>
    <div slot="trigger">
      <IconButton class="p-[4px]"><Icon type="history" size={16} /></IconButton>
    </div>
    <div class="text-base w-[700px] max-w-[700px] h-[400px] max-h-[400px]">
      <BaseInput
        icon="search"
        name={"publish-history-search" + connectionId}
        placeholder="Search history by topic or payload"
        bgColor={fieldColor}
        bgHoverColor={fieldHoverColor}
        inputClass="rounded-b-none"
        bind:value={searchText}
        actionButtons={searchText !== ""
          ? [
              {
                icon: "close",
                tooltipText: "Clear search",
                onClick: (e) => {
                  e.preventDefault();
                  e.stopImmediatePropagation();
                  console.log("Clearing search text");
                  searchText = "";
                },
              },
            ]
          : undefined}
      />
      <div class="h-[367px]">
        <VirtualList items={filteredHistory} let:item>
          <PublishHistoryItem
            onClick={() => {
              onItemClick(item);
            }}
            onCrossClick={() => {
              onCrossClick(item.id);
            }}
            retain={item.retain}
            searchString={searchText}
            topic={item.topic}
            payload={item.payload}
            timestamp={item.publishedAt}
            encoding={item.encoding}
            format={item.format}
          />
        </VirtualList>
      </div>
    </div>
  </Dialog>
{/if}
