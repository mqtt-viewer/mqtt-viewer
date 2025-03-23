<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import PanelHeader from "@/components/PanelHeader/PanelHeader.svelte";
  import type { SearchStore } from "../../stores/search";
  import type { ExpandedTopicsStore } from "../../stores/expanded-topics";
  import type {
    MqttDataSortDirection,
    MqttDataSortKey,
    MqttDataSortStore,
  } from "../../stores/sort";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import _ from "lodash";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import { ClearConnectionHistory } from "wailsjs/go/app/App";
  import { getConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import SearchAndHistory from "./SearchAndHistory.svelte";

  export let getAllTopics: () => string[];
  export let searchStore: SearchStore;
  export let expandedTopicsStore: ExpandedTopicsStore;
  export let sortStore: MqttDataSortStore;

  let searchText = $searchStore.text;
  const debouncedSetSearchText = _.debounce(searchStore.setSearchText, 200);
  $: searchText,
    (() => {
      if (searchText === "") {
        debouncedSetSearchText.cancel();
        searchStore.setSearchText("");
        return;
      }
      debouncedSetSearchText(searchText);
    })();

  $: onExpandClick = () => {
    if ($expandedTopicsStore.size > 0) {
      expandedTopicsStore.collapseAllTopics();
    } else {
      const allTopics = getAllTopics();
      expandedTopicsStore.expandMultipleTopics(allTopics);
    }
  };

  $: connectionId = getConnectionIdContext();

  $: onClearDataClick = async () => {
    try {
      await ClearConnectionHistory(connectionId);
    } catch (e) {
      console.error(e);
    }
  };

  const getSortButtonText = (
    key: MqttDataSortKey,
    dir: MqttDataSortDirection
  ) => {
    if (key === "time") {
      return dir === "desc" ? "Newest" : "Oldest";
    } else {
      return dir === "desc" ? "A → Z" : "Z → A";
    }
  };

  $: sortButtonText = getSortButtonText($sortStore.key, $sortStore.dir);
</script>

<PanelHeader class="bg-elevation-0">
  <div
    class="flex flex-row items-center h-full gap-2 px-2 text-white overflow-hidden"
  >
    <SearchAndHistory bind:searchText />
    <Tooltip placement="bottom">
      <Button on:click={onExpandClick}
        ><Icon
          type={$expandedTopicsStore.size > 0 ? "collapse" : "expand"}
          width={20}
          height={20}
        /></Button
      >
      <span slot="tooltip-content">Expand/Collapse all topics</span>
    </Tooltip>

    <Tooltip placement="bottom">
      <DropdownMenu triggerText={sortButtonText} triggerClass="w-[100px]">
        <div class="flex flex-col" slot="menu-content">
          <DropdownMenuItem
            isSelected={$sortStore.key === "topic" && $sortStore.dir === "desc"}
            onClick={() => sortStore.setSort("topic", "desc")}
            >Topic A → Z</DropdownMenuItem
          >
          <DropdownMenuItem
            isSelected={$sortStore.key === "topic" && $sortStore.dir === "asc"}
            onClick={() => sortStore.setSort("topic", "asc")}
            >Topic Z → A</DropdownMenuItem
          >
          <DropdownMenuItem
            isSelected={$sortStore.key === "time" && $sortStore.dir === "desc"}
            onClick={() => sortStore.setSort("time", "desc")}
            >Newest first</DropdownMenuItem
          >
          <DropdownMenuItem
            isSelected={$sortStore.key === "time" && $sortStore.dir === "asc"}
            onClick={() => sortStore.setSort("time", "asc")}
            >Oldest first</DropdownMenuItem
          >
        </div>
      </DropdownMenu>
      <span slot="tooltip-content">Sort topics</span>
    </Tooltip>
    <DropdownMenu>
      <span slot="trigger"
        ><Button variant="secondary" iconType="settings" iconSize={16}
        ></Button></span
      >

      <div class="flex flex-col" slot="menu-content">
        <DropdownMenuItem class="text-error" onClick={onClearDataClick}
          >Clear all data</DropdownMenuItem
        >
      </div>
    </DropdownMenu>
  </div>
</PanelHeader>
