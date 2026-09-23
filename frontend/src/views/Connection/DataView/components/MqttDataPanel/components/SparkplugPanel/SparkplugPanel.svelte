<script lang="ts">
  //@ts-ignore
  import VirtualList from "@sveltejs/svelte-virtual-list";
  import Icon from "@/components/Icon/Icon.svelte";
  import Button from "@/components/Button/Button.svelte";
  import { twMerge } from "tailwind-merge";
  import { onDestroy, tick } from "svelte";
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
    normaliseFilter,
    totalMetricCount,
    type SparkplugTreeRow,
  } from "./build-sparkplug-tree";
  import SparkplugRow from "./SparkplugRow.svelte";

  /** Store snapshot (plain state in, so stories can feed fixtures). */
  export let treeState: SparkplugTreeState;
  /** Panel width for the virtual-list row max-width math. */
  export let width: number;
  /**
   * Search text. Matches group, node, device and metric names, their
   * Group/Node paths, "alias N", and pasted Sparkplug topics.
   */
  export let filter: string = "";
  /**
   * False when the connection has Sparkplug topics but decoding is off, or
   * was only turned on since connecting. The panel then explains instead of
   * showing a tree.
   */
  export let decodingState: "on" | "off" | "needs-reconnect" = "on";
  /** The connection's state, which decides what turning decoding on does. */
  export let connectionState: "connected" | "disconnected" | "connecting" | "reconnecting" | "error" =
    "connected";
  /** True while decoding is being turned on (saving, then connecting). */
  export let enablingDecoding = false;
  export let onEnableDecoding: () => void = () => {};
  /** Asks for a rebirth (the caller confirms before publishing anything). */
  export let onRequestRebirth: (
    targets: { group: string; node: string; offline?: boolean }[]
  ) => void;
  export let onCopyMetricList: (node: SparkplugNode) => void;
  export let onSelectMetric: (metric: SparkplugMetric) => void = () => {};
  export let onCopyValue: (metric: SparkplugMetric) => void = () => {};
  export let onClearWarnings: () => void = () => {};
  /** Clears the search, so a warning click can reveal a node it hides. */
  export let onClearFilter: () => void = () => {};

  const ROW_HEIGHT_PX = 19;
  // Above this many metric rows the tree opens with nodes collapsed, so a
  // plant-sized fleet starts as a scannable list of nodes rather than tens of
  // thousands of rows.
  const EXPAND_BY_DEFAULT_MAX_METRICS = 400;
  // Below this the type column goes and status badges fold into an icon, so
  // a panel docked beside the payload still shows names and values.
  const COMPACT_WIDTH_PX = 560;

  $: compact = width > 0 && width < COMPACT_WIDTH_PX;

  // The user's own expand/collapse clicks, by key. Expand all and collapse
  // all replace the default and clear them.
  let expansion = new Map<string, boolean>();
  let defaultOverride: boolean | null = null;
  let problemsOnly = false;

  $: metricTotal = totalMetricCount(treeState.groups);
  // Follows the fleet's size until the user first touches the tree, then
  // holds. Live traffic fills the tree over the first seconds, so deciding
  // on the first snapshot would open a whole plant; deciding for good later
  // would collapse rows the user is reading.
  let userInteracted = false;
  let heldDefault = true;
  $: if (!userInteracted) heldDefault = metricTotal <= EXPAND_BY_DEFAULT_MAX_METRICS;
  $: defaultExpanded = defaultOverride ?? heldDefault;
  const markInteracted = () => (userInteracted = true);
  $: filtering = normaliseFilter(filter) !== "";
  // Searching counts as touching the tree too.
  $: if (filtering) markInteracted();

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
  $: unknownCount = allNodes.length - onlineCount - offlineCount;
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

  // --- Scrolling --------------------------------------------------------------
  let treeElement: HTMLDivElement;
  const viewport = () =>
    treeElement?.querySelector("svelte-virtual-list-viewport") as HTMLElement | null;

  // The virtual list keeps its scroll offset when the row list shrinks, and
  // past the new end it renders nothing at all. Pull it back into range.
  const clampScroll = () => {
    requestAnimationFrame(() => {
      const vp = viewport();
      if (!vp) return;
      const max = Math.max(0, rows.length * ROW_HEIGHT_PX - vp.clientHeight);
      if (vp.scrollTop > max) {
        vp.scrollTop = max;
        vp.dispatchEvent(new Event("scroll"));
      }
    });
  };
  $: rows, clampScroll();

  // A new search or filter starts at the top of its results, unless a
  // warning click cleared the search to reveal a node: then it goes there.
  const onFilterChange = () => {
    if (pendingReveal !== null) {
      const key = pendingReveal;
      pendingReveal = null;
      void revealKey(key);
      return;
    }
    const vp = viewport();
    if (vp && vp.scrollTop !== 0) {
      vp.scrollTop = 0;
      vp.dispatchEvent(new Event("scroll"));
    }
  };
  $: filter, problemsOnly, onFilterChange();

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  // svelte-virtual-list mis-measures a jump up into rows it has never
  // rendered (its height map has gaps there) and scrolls to the top instead.
  // A long jump up therefore goes to the top first, then down to the target.
  const jumpTo = async (top: number) => {
    const vp = viewport();
    if (!vp) return;
    if (top < vp.scrollTop - vp.clientHeight) {
      vp.scrollTop = 0;
      vp.dispatchEvent(new Event("scroll"));
      await nextFrame();
      await nextFrame();
    }
    vp.scrollTop = top;
    vp.dispatchEvent(new Event("scroll"));
  };

  const scrollRowIntoView = (index: number) => {
    const vp = viewport();
    if (!vp) return;
    const top = index * ROW_HEIGHT_PX;
    const bottom = top + ROW_HEIGHT_PX;
    if (top < vp.scrollTop) {
      vp.scrollTop = top;
    } else if (bottom > vp.scrollTop + vp.clientHeight) {
      vp.scrollTop = bottom - vp.clientHeight;
    } else {
      return;
    }
    vp.dispatchEvent(new Event("scroll"));
  };

  // --- Keyboard cursor and selection -----------------------------------------
  // Focus stays on the tree element and the cursor row is its
  // aria-activedescendant, because the virtual list only renders the rows in
  // view: a roving tabindex would lose the cursor as soon as it scrolled out.
  const treeId = `sparkplug-tree-${Math.random().toString(36).slice(2, 8)}`;
  let activeRowId: string | null = null;
  let activeIndexHint = 0;
  // treeHasFocus drives the screen reader cursor, treeFocused the visible
  // one (keyboard focus only).
  let treeHasFocus = false;
  let treeFocused = false;
  let selectedRowId: string | null = null;

  $: activeIndex = (() => {
    if (rows.length === 0) return -1;
    if (activeRowId !== null) {
      // The hint is right unless rows moved; only then search.
      const hinted = rows[activeIndexHint];
      if (hinted?.id === activeRowId) return activeIndexHint;
      const found = rows.findIndex((r) => r.id === activeRowId);
      if (found !== -1) return found;
    }
    return Math.min(activeIndexHint, rows.length - 1);
  })();
  $: activeRow = activeIndex >= 0 ? rows[activeIndex] : undefined;
  $: activeDescendant = activeRow && treeHasFocus ? `${treeId}-${activeRow.index}` : undefined;

  const moveTo = (index: number) => {
    const row = rows[index];
    if (!row) return;
    activeRowId = row.id;
    activeIndexHint = index;
    scrollRowIntoView(index);
  };

  const act = (row: SparkplugTreeRow) => {
    if (row.kind !== "metric") {
      // Everything shows open while searching; a toggle then would only
      // change what shows after the search is cleared.
      if (!filtering) toggleExpansion(row.key);
    } else if (row.metric) {
      selectedRowId = row.id;
      onSelectMetric(row.metric);
    }
  };

  const onRowActivate = (row: SparkplugTreeRow) => {
    activeRowId = row.id;
    activeIndexHint = row.index;
    act(row);
  };

  const pageSize = () =>
    Math.max(1, Math.floor((viewport()?.clientHeight ?? ROW_HEIGHT_PX * 10) / ROW_HEIGHT_PX) - 1);

  // The cursor ring is for keyboard users: a mouse click that focuses the
  // tree already shows its selection.
  const onTreeFocus = () => {
    treeHasFocus = true;
    try {
      treeFocused = treeElement.matches(":focus-visible");
    } catch (_) {
      treeFocused = true;
    }
  };

  const onTreeKeydown = (e: KeyboardEvent) => {
    markInteracted();
    // Keys pressed on a row's own buttons are theirs.
    if (e.target !== treeElement || activeIndex === -1) return;
    treeFocused = true;
    const i = activeIndex;
    const row = rows[i];
    const last = rows.length - 1;
    const canToggle = row.kind !== "metric" && !filtering;
    switch (e.key) {
      case "ArrowDown":
        moveTo(Math.min(last, i + 1));
        break;
      case "ArrowUp":
        moveTo(Math.max(0, i - 1));
        break;
      case "PageDown":
        moveTo(Math.min(last, i + pageSize()));
        break;
      case "PageUp":
        moveTo(Math.max(0, i - pageSize()));
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(last);
        break;
      case "ArrowRight":
        if (canToggle && !row.isExpanded) toggleExpansion(row.key);
        else if (row.kind !== "metric") moveTo(Math.min(last, i + 1));
        break;
      case "ArrowLeft": {
        if (canToggle && row.isExpanded) {
          toggleExpansion(row.key);
          break;
        }
        for (let j = i - 1; j >= 0; j--) {
          if (rows[j].levelCount < row.levelCount) {
            moveTo(j);
            break;
          }
        }
        break;
      }
      case "Enter":
      case " ":
        act(row);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // --- Reveal from a warning ------------------------------------------------
  let highlightedKey: string | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  // A node to reveal once a cleared search has reached this panel.
  let pendingReveal: string | null = null;

  const revealKey = async (key: string) => {
    // Let the list settle on the rows the expansion just changed.
    await tick();
    await nextFrame();
    const index = rows.findIndex((r) => r.kind === "node" && r.key === key);
    if (index === -1) return;
    await jumpTo(Math.max(0, index * ROW_HEIGHT_PX - ROW_HEIGHT_PX * 2));
    activeRowId = rows[index].id;
    activeIndexHint = index;
    highlightedKey = key;
    if (highlightTimer !== null) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => (highlightedKey = null), 1500);
  };

  /** Opens the path to a node, scrolls it into view and flashes it. */
  const revealNode = async (warning: SparkplugWarning) => {
    markInteracted();
    const key = nodeKeyOf(warning.group, warning.node);
    expansion.set(warning.group, true);
    expansion.set(key, true);
    expansion = expansion;
    problemsOnly = false;
    await tick();
    if (filtering && !rows.some((r) => r.kind === "node" && r.key === key)) {
      // The search hides it. Drop the search; the reveal finishes when the
      // cleared search arrives (see onFilterChange).
      pendingReveal = key;
      onClearFilter();
      return;
    }
    await revealKey(key);
  };

  // Keeps the keyboard cursor in view when the tree gets shorter (the
  // warnings strip grows, the window shrinks): off screen it isn't rendered,
  // and a screen reader's active descendant would point at nothing. An
  // action, so a tree element that remounts (after an empty search, say)
  // gets its own observer.
  const keepCursorInView = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return {};
    const observer = new ResizeObserver(() => {
      if (treeHasFocus && activeIndex >= 0) scrollRowIntoView(activeIndex);
    });
    observer.observe(el);
    return { destroy: () => observer.disconnect() };
  };
  onDestroy(() => {
    if (highlightTimer !== null) clearTimeout(highlightTimer);
  });

  // The rebirth banner goes away once the births it asked for arrive, and a
  // keyboard user's focus, back on its button after the dialog, would drop
  // to the page. When the last candidate resolves soon after a request, the
  // tree takes focus instead, if nothing else has it.
  let bulkRequestedAt = -Infinity;
  $: if (rebirthCandidates.length === 0 && performance.now() - bulkRequestedAt < 60_000) {
    bulkRequestedAt = -Infinity;
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) treeElement?.focus();
    });
  }

  const requestRebirthForCandidates = () => {
    bulkRequestedAt = performance.now();
    onRequestRebirth(rebirthCandidates.map((n) => ({ group: n.group, node: n.name })));
  };

  const requestRebirthForNode = (node: SparkplugNode) =>
    onRequestRebirth([{ group: node.group, node: node.name, offline: node.status === "offline" }]);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
</script>

<div class="h-full w-full min-w-0 flex flex-col overflow-hidden text-sm">
  {#if decodingState !== "on"}
    {@const retrying = connectionState === "connecting" || connectionState === "reconnecting"}
    <div class="grow flex flex-col items-center justify-center gap-3 px-6 text-center text-secondary-text">
      {#if enablingDecoding}
        <div class="text-base text-emphasis">Turning on Sparkplug decoding</div>
      {:else if decodingState === "off"}
        <div class="text-base text-emphasis">Sparkplug decoding is off</div>
        <p class="max-w-[360px]">
          This connection has Sparkplug B topics, but their payloads are shown
          as raw protobuf. Turn on decoding to see the node tree with metric
          names and values.
          {#if retrying}
            It starts from a connect: once the connection is back, reconnect.
          {:else if connectionState === "connected"}
            I'll reconnect to start decoding.
          {:else}
            I'll connect to start decoding.
          {/if}
        </p>
        <Button on:click={onEnableDecoding}
          >{retrying
            ? "Turn on"
            : connectionState === "connected"
              ? "Turn on and reconnect"
              : "Turn on and connect"}</Button
        >
      {:else if retrying}
        <div class="text-base text-emphasis">Decoding starts on the next connect</div>
        <p class="max-w-[360px]">
          The connection is retrying now. Once it's back, reconnect to start
          decoding.
        </p>
      {:else if connectionState === "connected"}
        <div class="text-base text-emphasis">Reconnect to start decoding</div>
        <p class="max-w-[360px]">
          Sparkplug decoding was turned on after this connection started, so
          it applies from the next connect.
        </p>
        <Button on:click={onEnableDecoding}>Reconnect</Button>
      {:else}
        <div class="text-base text-emphasis">Connect to start decoding</div>
        <p class="max-w-[360px]">
          Sparkplug decoding is on. The node tree fills in once the connection
          is up and births or data arrive.
        </p>
        <Button on:click={onEnableDecoding}>Connect</Button>
      {/if}
    </div>
  {:else}
    {#if !treeState.connected && treeState.droppedAtMs !== undefined}
      <div class="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-divider text-secondary-text">
        <Icon type="info" size={14} />
        <span class="min-w-0"
          >Not connected. This is the state as of {formatClockTime(treeState.droppedAtMs)}.</span
        >
      </div>
    {:else if rebirthCandidates.length > 0}
      <div class="shrink-0 border-b border-divider text-secondary-text">
        <div class="flex items-center gap-2 px-2 py-1 max-w-[1000px]">
          <span class="shrink-0 text-warning"><Icon type="warning" size={14} /></span>
          <span class="min-w-0 line-clamp-2" title={unverifiedCount > 0
            ? "Aliases belong to each node's session, which carried on while disconnected. A node that rebirthed in that time may have reassigned them."
            : "Births are only sent when a node connects or is asked for one, so a viewer that connects later sees aliases until then."}>
            {#if unresolvedCount > 0}
              {plural(unresolvedCount, "node")}
              {unresolvedCount === 1 ? "hasn't" : "haven't"} sent a birth since connecting, so
              some metrics show aliases, not names.
            {/if}
            {#if unverifiedCount > 0}
              {plural(unverifiedCount, "node")}
              {unverifiedCount === 1 ? "has" : "have"} names from before the connection dropped.
            {/if}
          </span>
          <div class="grow"></div>
          <Button
            variant="text"
            class="text-sm shrink-0"
            disabled={!treeState.connected}
            on:click={requestRebirthForCandidates}
            >{rebirthCandidates.length === 1 ? "Request rebirth" : `Request ${rebirthCandidates.length} rebirths`}</Button
          >
        </div>
      </div>
    {/if}

    {#if allNodes.length > 0}
      <div class="shrink-0 border-b border-divider text-secondary-text">
        <div class="flex items-center gap-3 px-2 py-0.5 whitespace-nowrap overflow-hidden max-w-[1000px]">
          <span class="truncate min-w-0">
            {plural(allNodes.length, "node")}: {onlineCount} online{#if offlineCount > 0}, {offlineCount} offline{/if}{#if unknownCount > 0}, {unknownCount} unknown{/if}
          </span>
          <div class="grow"></div>
          <button
            type="button"
            class={twMerge(
              "shrink-0 rounded px-1.5 hover:text-emphasis",
              problemsOnly && "bg-elevation-2 text-white-text"
            )}
            aria-pressed={problemsOnly}
            title="Show only nodes that are offline, have a seq gap or rebirth storm, show aliases instead of names, or have a device offline or awaiting its birth"
            on:click={() => {
              markInteracted();
              problemsOnly = !problemsOnly;
            }}
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
      </div>
    {/if}

    {#if treeState.hosts.length > 0}
      <div
        class="shrink-0 flex items-center gap-4 px-2 py-0.5 text-secondary-text font-mono border-b border-divider overflow-x-hidden whitespace-nowrap"
      >
        <span class="font-sans">Host applications</span>
        {#each treeState.hosts as host (host.hostId)}
          <!-- A host's state is only known while connected: its death can
               be missed while the viewer is away. -->
          {@const known = treeState.connected}
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="truncate">{host.hostId}</span>
            <span
              class={twMerge(
                "size-1.5 rounded-full shrink-0",
                !known ? "bg-secondary-text" : host.online ? "bg-success" : "bg-error"
              )}
            ></span>
            <span
              >{#if known}{host.online ? "online" : "offline"} since {formatClockTime(host.sinceMs)}{:else}unknown,
                last {host.online ? "online" : "offline"} at {formatClockTime(host.sinceMs)}{/if}</span
            >
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
        {problemsOnly && !filtering ? "No nodes need attention" : "Nothing matches the search"}
      </div>
    {:else}
      <div
        class="grow min-h-0 w-full max-w-full overflow-hidden pl-2 outline-none"
        role="tree"
        aria-label="Sparkplug nodes"
        tabindex="0"
        aria-activedescendant={activeDescendant}
        bind:this={treeElement}
        use:keepCursorInView
        on:keydown={onTreeKeydown}
        on:pointerdown={markInteracted}
        on:wheel|passive={markInteracted}
        on:focus={onTreeFocus}
        on:blur={() => {
          treeHasFocus = false;
          treeFocused = false;
        }}
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
                domId={`${treeId}-${item.index}`}
                isSelected={selectedRowId === item.id}
                isActive={activeRow?.id === item.id}
                {treeFocused}
                isHighlighted={item.kind === "node" && highlightedKey === item.key}
                {compact}
                connected={treeState.connected}
                onActivate={onRowActivate}
                onRequestRebirth={requestRebirthForNode}
                {onCopyMetricList}
                {onCopyValue}
              />
            </div>
          </div>
        </VirtualList>
      </div>
    {/if}

    {#if treeState.warnings.length > 0}
      <div class="shrink-0 border-t border-divider">
        <div class="flex items-center gap-2 px-2 pt-0.5 text-secondary-text max-w-[1000px]">
          <span>{plural(treeState.warnings.length, "warning")}</span>
          <div class="grow"></div>
          <button
            type="button"
            class="shrink-0 rounded px-1.5 hover:text-emphasis"
            title="Clear these warnings"
            on:click={onClearWarnings}>Clear</button
          >
        </div>
        <div class="max-h-24 overflow-y-auto px-2 pb-0.5">
          {#each warningsNewestFirst as warning}
            <button
              type="button"
              class="w-full flex items-center gap-1.5 text-warning font-mono whitespace-nowrap overflow-hidden text-left rounded hover:bg-hovered"
              title={`${formatClockTime(warning.timeMs)} ${warning.group}/${warning.node}: ${warning.text}. Click to show the node.`}
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
      </div>
    {/if}
  {/if}
</div>
