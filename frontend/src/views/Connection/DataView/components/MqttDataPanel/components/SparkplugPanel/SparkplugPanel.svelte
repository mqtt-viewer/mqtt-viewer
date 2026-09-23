<script lang="ts">
  //@ts-ignore
  import VirtualList from "@sveltejs/svelte-virtual-list";
  import Icon from "@/components/Icon/Icon.svelte";
  import Button from "@/components/Button/Button.svelte";
  import { twMerge } from "tailwind-merge";
  import { tick } from "svelte";
  import type {
    SparkplugMetric,
    SparkplugNode,
    SparkplugTreeState,
    SparkplugWarning,
  } from "../../stores/sparkplug-tree-store";
  import {
    buildSparkplugTree,
    formatClockTime,
    needsRebirth,
    nodeKeyOf,
    nodeProblems,
    totalMetricCount,
  } from "./build-sparkplug-tree";
  import SparkplugRow from "./SparkplugRow.svelte";

  /** Store snapshot (plain state in, so stories can feed fixtures). */
  export let treeState: SparkplugTreeState;
  /** Panel width for the virtual-list row max-width math. */
  export let width: number;
  /** Case-insensitive substring filter on group/node/device/metric names. */
  export let filter: string = "";
  /**
   * False when the connection has Sparkplug topics but decoding is off, or
   * was only turned on since connecting. The panel then explains instead of
   * showing a tree.
   */
  export let decodingState: "on" | "off" | "needs-reconnect" = "on";
  export let onEnableDecoding: () => void = () => {};
  /** Asks for a rebirth (the caller confirms before publishing anything). */
  export let onRequestRebirth: (targets: { group: string; node: string }[]) => void;
  export let onCopyMetricList: (node: SparkplugNode) => void;
  export let onSelectMetric: (metric: SparkplugMetric) => void = () => {};
  export let onCopyValue: (metric: SparkplugMetric) => void = () => {};

  const ROW_HEIGHT_PX = 19;
  // Above this many metric rows the tree opens with nodes collapsed, so a
  // plant-sized fleet starts as a scannable list of nodes rather than tens of
  // thousands of rows.
  const EXPAND_BY_DEFAULT_MAX_METRICS = 400;

  // The user's own expand/collapse clicks, by key. Expand all and collapse
  // all replace the default and clear them.
  let expansion = new Map<string, boolean>();
  let defaultOverride: boolean | null = null;
  let problemsOnly = false;

  $: metricTotal = totalMetricCount(treeState.groups);
  $: defaultExpanded =
    defaultOverride ?? metricTotal <= EXPAND_BY_DEFAULT_MAX_METRICS;

  const toggleExpansion = (key: string) => {
    const isGroup = !key.includes("/");
    const current = expansion.get(key) ?? (isGroup ? true : defaultExpanded);
    expansion.set(key, !current);
    expansion = expansion;
  };

  const setAll = (open: boolean) => {
    expansion = new Map();
    defaultOverride = open;
  };

  $: rows = buildSparkplugTree({
    groups: treeState.groups,
    expansion,
    defaultExpanded,
    filter,
    problemsOnly,
  });

  // --- Summary ----------------------------------------------------------------
  $: allNodes = treeState.groups.flatMap((g) => g.nodes);
  $: onlineCount = allNodes.filter((n) => n.status === "online").length;
  $: offlineCount = allNodes.filter((n) => n.status === "offline").length;
  $: problemCount = allNodes.filter((n) => nodeProblems(n).length > 0).length;
  $: rebirthCandidates = allNodes.filter(needsRebirth);
  $: unresolvedCount = rebirthCandidates.filter(
    (n) => n.placeholderCount > 0 || n.devices.some((d) => d.placeholderCount > 0)
  ).length;
  $: unverifiedCount = rebirthCandidates.length - unresolvedCount;

  $: isEmpty = treeState.groups.length === 0 && treeState.hosts.length === 0;

  // The store keeps warnings newest last; the strip is short and scrolls, so
  // show the newest first to keep the most urgent one above the fold. Sorted
  // by time rather than reversed: a live storm warning refreshes in place, so
  // its position in the store's array no longer matches its timestamp.
  $: warningsNewestFirst = [...treeState.warnings].sort(
    (a, b) => b.timeMs - a.timeMs
  );

  // --- Selection and reveal ---------------------------------------------------
  let selectedRowKey: string | null = null;
  let highlightedKey: string | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  let treeElement: HTMLDivElement;

  const selectMetric = (metric: SparkplugMetric, rowKey: string) => {
    selectedRowKey = rowKey;
    onSelectMetric(metric);
  };

  /** Opens the path to a node, scrolls it into view and flashes it. */
  const revealNode = async (warning: SparkplugWarning) => {
    const key = nodeKeyOf(warning.group, warning.node);
    expansion.set(warning.group, true);
    expansion.set(key, true);
    expansion = expansion;
    problemsOnly = false;
    await tick();
    const index = rows.findIndex((r) => r.kind === "node" && r.key === key);
    if (index === -1) return;
    const viewport = treeElement?.querySelector("svelte-virtual-list-viewport") as HTMLElement | null;
    if (viewport) viewport.scrollTop = Math.max(0, index * ROW_HEIGHT_PX - ROW_HEIGHT_PX * 2);
    highlightedKey = key;
    if (highlightTimer !== null) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => (highlightedKey = null), 1500);
  };

  const requestRebirthForCandidates = () =>
    onRequestRebirth(rebirthCandidates.map((n) => ({ group: n.group, node: n.name })));

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
</script>

<div class="h-full w-full min-w-0 flex flex-col overflow-hidden text-sm">
  {#if decodingState !== "on"}
    <div class="grow flex flex-col items-center justify-center gap-3 px-6 text-center text-secondary-text">
      {#if decodingState === "off"}
        <div class="text-base text-emphasis">Sparkplug decoding is off</div>
        <p class="max-w-[360px]">
          This connection is receiving Sparkplug B messages, but they're shown
          as raw protobuf. Turn on decoding to see metric names, values and the
          node tree. I'll reconnect to start decoding.
        </p>
        <Button on:click={onEnableDecoding}>Turn on and reconnect</Button>
      {:else}
        <div class="text-base text-emphasis">Reconnect to start decoding</div>
        <p class="max-w-[360px]">
          Sparkplug decoding was turned on after this connection started, so
          it applies from the next connect.
        </p>
        <Button on:click={onEnableDecoding}>Reconnect</Button>
      {/if}
    </div>
  {:else}
    {#if !treeState.connected && treeState.droppedAtMs !== undefined}
      <div class="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-divider text-secondary-text">
        <Icon type="info" size={14} />
        <span class="truncate"
          >Not connected. This is the state as of {formatClockTime(treeState.droppedAtMs)}.</span
        >
      </div>
    {:else if rebirthCandidates.length > 0}
      <div class="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-divider text-secondary-text">
        <span class="shrink-0 text-warning"><Icon type="warning" size={14} /></span>
        <span class="truncate min-w-0" title={unverifiedCount > 0
          ? "Aliases belong to each node's session, which carried on while disconnected. A node that rebirthed in that time may have reassigned them."
          : "Births are only sent when a node connects or is asked for one, so a viewer that connects later sees aliases until then."}>
          {#if unresolvedCount > 0}
            {plural(unresolvedCount, "node")} haven't sent a birth since connecting, so some metrics show aliases, not names.
          {/if}
          {#if unverifiedCount > 0}
            {plural(unverifiedCount, "node")} {unverifiedCount === 1 ? "has" : "have"} names from before the connection dropped.
          {/if}
        </span>
        <div class="grow"></div>
        <Button variant="text" class="text-sm shrink-0" on:click={requestRebirthForCandidates}
          >{rebirthCandidates.length === 1 ? "Request rebirth" : `Request ${rebirthCandidates.length} rebirths`}</Button
        >
      </div>
    {/if}

    {#if !isEmpty}
      <div class="shrink-0 flex items-center gap-3 px-2 py-0.5 border-b border-divider text-secondary-text whitespace-nowrap overflow-hidden">
        <span class="truncate">
          {plural(allNodes.length, "node")}: {onlineCount} online{#if offlineCount > 0}, {offlineCount} offline{/if}{#if allNodes.length - onlineCount - offlineCount > 0}, {allNodes.length - onlineCount - offlineCount} unknown{/if}
        </span>
        <div class="grow"></div>
        <button
          type="button"
          class={twMerge(
            "shrink-0 rounded px-1.5 hover:text-emphasis",
            problemsOnly && "bg-elevation-2 text-white-text"
          )}
          aria-pressed={problemsOnly}
          title="Show only nodes that are offline, have seq gaps or rebirth storms, or show aliases"
          on:click={() => (problemsOnly = !problemsOnly)}
          >Problems{#if problemCount > 0}<span class="ml-1 text-warning">{problemCount}</span>{/if}</button
        >
        <button
          type="button"
          class="shrink-0 rounded px-1 hover:text-emphasis"
          title="Expand all"
          aria-label="Expand all"
          on:click={() => setAll(true)}><Icon type="expand" size={16} /></button
        >
        <button
          type="button"
          class="shrink-0 rounded px-1 hover:text-emphasis"
          title="Collapse all"
          aria-label="Collapse all"
          on:click={() => setAll(false)}><Icon type="collapse" size={16} /></button
        >
      </div>
    {/if}

    {#if treeState.hosts.length > 0}
      <div
        class="shrink-0 flex items-center gap-4 px-2 py-0.5 text-secondary-text font-mono border-b border-divider overflow-x-hidden whitespace-nowrap"
      >
        <span class="font-sans">Host applications</span>
        {#each treeState.hosts as host (host.hostId)}
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="truncate">{host.hostId}</span>
            <span
              class={twMerge(
                "size-1.5 rounded-full shrink-0",
                host.online ? "bg-success" : "bg-error"
              )}
            ></span>
            <span>{host.online ? "online" : "offline"} since {formatClockTime(host.sinceMs)}</span>
          </span>
        {/each}
      </div>
    {/if}

    {#if isEmpty}
      <div
        class="grow flex items-center justify-center text-secondary-text"
      >
        {treeState.replaying ? "Loading the Sparkplug session" : "Waiting for Sparkplug traffic"}
      </div>
    {:else if rows.length === 0}
      <div class="grow flex items-center justify-center text-secondary-text">
        {problemsOnly ? "No nodes need attention" : "Nothing matches the search"}
      </div>
    {:else}
      <div
        class="grow min-h-0 w-full max-w-full overflow-hidden pl-2"
        role="tree"
        aria-label="Sparkplug nodes"
        bind:this={treeElement}
      >
        <VirtualList items={rows} let:item itemHeight={ROW_HEIGHT_PX}>
          {@const marginLeftPx = item.levelCount * 18}
          {@const maxWidth = width - marginLeftPx - 8}
          <div class="flex">
            <div style:min-width={`${marginLeftPx}px`}></div>
            <div class="grow min-w-0" style:max-width={`${maxWidth}px`}>
              <SparkplugRow
                row={item}
                nowMs={treeState.nowMs}
                isSelected={item.kind === "metric" &&
                  item.metric !== undefined &&
                  selectedRowKey === `${item.key}/${item.metric.name}`}
                isHighlighted={item.kind === "node" && highlightedKey === item.key}
                onToggleExpansion={toggleExpansion}
                onRequestRebirth={(group, node) => onRequestRebirth([{ group, node }])}
                {onCopyMetricList}
                onSelectMetric={selectMetric}
                {onCopyValue}
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
        {#each warningsNewestFirst as warning}
          <button
            type="button"
            class="w-full flex items-center gap-1.5 text-warning font-mono whitespace-nowrap overflow-hidden text-left rounded hover:bg-hovered"
            title="Show this node in the tree"
            on:click={() => revealNode(warning)}
          >
            <span class="shrink-0"><Icon type="warning" size={14} /></span>
            <span class="truncate">
              {formatClockTime(warning.timeMs)}
              {warning.group}/{warning.node}: {warning.text}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>
