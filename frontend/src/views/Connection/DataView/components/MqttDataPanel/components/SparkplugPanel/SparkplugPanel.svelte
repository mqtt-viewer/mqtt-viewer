<script lang="ts">
  //@ts-ignore
  import VirtualList from "@sveltejs/svelte-virtual-list";
  import Icon from "@/components/Icon/Icon.svelte";
  import { twMerge } from "tailwind-merge";
  import type {
    SparkplugNode,
    SparkplugTreeState,
  } from "../../stores/sparkplug-tree-store";
  import {
    buildSparkplugTree,
    formatClockTime,
  } from "./build-sparkplug-tree";
  import SparkplugRow from "./SparkplugRow.svelte";

  /** Store snapshot (plain state in, so stories can feed fixtures). */
  export let treeState: SparkplugTreeState;
  /** Panel width for the virtual-list row max-width math. */
  export let width: number;
  /** Case-insensitive substring filter on node/device/metric names. */
  export let filter: string = "";
  export let onRequestRebirth: (group: string, node: string) => void;
  export let onCopyMetricList: (node: SparkplugNode) => void;

  // Expansion state: keys the user collapsed (everything defaults expanded).
  // Local to the panel; a fresh mount starts fully expanded.
  let collapsedKeys = new Set<string>();
  const toggleExpansion = (key: string) => {
    if (collapsedKeys.has(key)) {
      collapsedKeys.delete(key);
    } else {
      collapsedKeys.add(key);
    }
    collapsedKeys = collapsedKeys; // reassign for reactivity
  };

  $: rows = buildSparkplugTree({
    groups: treeState.groups,
    collapsedKeys,
    filter,
  });
  $: isEmpty = treeState.groups.length === 0 && treeState.hosts.length === 0;
</script>

<div class="h-full w-full min-w-0 flex flex-col overflow-hidden">
  {#if treeState.hosts.length > 0}
    <div
      class="shrink-0 flex items-center gap-4 px-2 py-0.5 text-sm text-secondary-text font-mono border-b border-divider overflow-x-hidden whitespace-nowrap"
    >
      {#each treeState.hosts as host (host.hostId)}
        <span class="flex items-center gap-1.5 min-w-0">
          <span class="truncate">{host.hostId}</span>
          <span
            class={twMerge(
              "size-1.5 rounded-full shrink-0",
              host.online ? "bg-success" : "bg-error"
            )}
          ></span>
          <span>{host.online ? "online" : "offline"}</span>
          <span>since {formatClockTime(host.sinceMs)}</span>
        </span>
      {/each}
    </div>
  {/if}

  {#if isEmpty}
    <div
      class="grow flex items-center justify-center text-sm text-secondary-text"
    >
      Waiting for Sparkplug traffic
    </div>
  {:else}
    <div class="grow min-h-0 w-full max-w-full overflow-hidden pl-2">
      <VirtualList items={rows} let:item itemHeight={19}>
        {@const marginLeftPx = item.levelCount * 18}
        {@const maxWidth = width - marginLeftPx - 8}
        <div class="flex">
          <div style:min-width={`${marginLeftPx}px`}></div>
          <div class="grow min-w-0 truncate" style:max-width={`${maxWidth}px`}>
            <SparkplugRow
              row={item}
              nowMs={treeState.nowMs}
              onToggleExpansion={toggleExpansion}
              {onRequestRebirth}
              {onCopyMetricList}
            />
          </div>
        </div>
      </VirtualList>
    </div>
  {/if}

  {#if treeState.warnings.length > 0}
    <div
      class="shrink-0 border-t border-divider max-h-24 overflow-y-auto px-2 py-0.5"
    >
      {#each treeState.warnings as warning}
        <div
          class="flex items-center gap-1.5 text-sm text-warning font-mono whitespace-nowrap overflow-hidden"
        >
          <span class="shrink-0"><Icon type="warning" size={14} /></span>
          <span class="truncate">
            {warning.node}: {warning.text} at {formatClockTime(warning.timeMs)}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>
