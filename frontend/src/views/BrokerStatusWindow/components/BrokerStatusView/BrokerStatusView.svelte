<script lang="ts">
  // Body of the detached Broker Status window: a responsive grid of stat tiles
  // (builtins + custom/override mappings) with an always-last "+" tile, an
  // empty-state block for brokers that publish no $SYS, and a collapsible raw
  // $SYS topic browser. The window shell owns the store's lifecycle; this view
  // only reads the store and drives the mapping editor.
  import { onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import StatTile from "../StatTile/StatTile.svelte";
  import MetricMappingEditor from "../MetricMappingEditor/MetricMappingEditor.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import subscriptions from "@/stores/subscriptions";
  import type { BrokerStatusStore } from "../../broker-status-store";
  import { nowTick, formatAge } from "./raw-browser";

  export let store: BrokerStatusStore;
  export let connectionId: number;

  const SYS_TOPIC = "$SYS/#";
  const EMPTY_GRACE_MS = 10_000;
  const MAX_RAW_ROWS = 500;

  // Mapping editor, owned here so the "+" tile and pin buttons can open it.
  const editorOpen = writable(false);
  let editorPrefill: { topic?: string; label?: string } | null = null;

  const openAddEditor = () => {
    editorPrefill = null;
    editorOpen.set(true);
  };
  // Also callable by the window shell (header gear) via bind:this.
  export function openMappingEditor() {
    openAddEditor();
  }
  const pinTopic = (topic: string) => {
    const segments = topic.split("/").filter((s) => s !== "");
    editorPrefill = { topic, label: segments[segments.length - 1] ?? topic };
    editorOpen.set(true);
  };

  // Empty-state grace: only offer the "no $SYS" explanation once the window
  // has been open ~10 s without seeing any $SYS message. Re-arm when the store
  // resets its opened-at clock (history cleared), but not on every flush.
  let graceElapsed = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastOpenedAt = -1;

  const armGrace = (openedAt: number) => {
    graceElapsed = false;
    if (graceTimer) clearTimeout(graceTimer);
    const remaining = Math.max(0, EMPTY_GRACE_MS - (Date.now() - openedAt));
    graceTimer = setTimeout(() => (graceElapsed = true), remaining);
  };

  $: if ($store.windowOpenedAt !== lastOpenedAt) {
    lastOpenedAt = $store.windowOpenedAt;
    armGrace($store.windowOpenedAt);
  }

  onDestroy(() => {
    if (graceTimer) clearTimeout(graceTimer);
  });

  $: showEmptyState = !$store.sysEverSeen && $store.connected && graceElapsed;

  // In the empty state (no $SYS ever seen, grace elapsed) the builtin tiles can
  // never populate, so hide the ones with no data and show only tiles that
  // actually carry a value (observed rates, any custom tiles with data) plus
  // the always-present "+". During the grace window keep every tile visible so
  // it can still fill in from retained $SYS as messages arrive.
  $: visibleTiles = showEmptyState
    ? $store.tiles.filter((tile) => tile.valueKind !== "empty")
    : $store.tiles;

  // Whether this connection still has a $SYS/# subscription row — drives the
  // "Add $SYS/# subscription" CTA in the empty state.
  $: connSubs = $subscriptions.subscriptionsByConnectionId[connectionId] ?? [];
  $: hasSysSubscription = connSubs.some((s) => s.topic === SYS_TOPIC);

  let addingSysSub = false;
  const addSysSubscription = async () => {
    addingSysSub = true;
    try {
      const created = await subscriptions.addSubscription(connectionId);
      if (created) {
        await subscriptions.updateSubscription(connectionId, {
          ...created,
          topic: SYS_TOPIC,
        });
      }
      addToast({
        data: {
          title: "Subscription added",
          description: "Reconnect to apply",
          type: "success",
        },
      });
    } catch (e) {
      console.error("Failed to add $SYS/# subscription", e);
      addToast({
        data: {
          title: "Subscription",
          description: "Could not add the $SYS/# subscription",
          type: "error",
        },
      });
    } finally {
      addingSysSub = false;
    }
  };

  // Raw $SYS browser.
  let rawExpanded = false;
  let rawFilter = "";

  // Only build and sort the entry list while the browser is expanded; when
  // collapsed the header just needs the topic count, which the store's Map
  // gives in O(1). Under a busy broker this skips a sort of every $SYS topic on
  // every flush.
  $: rawEntries = rawExpanded
    ? Array.from($store.latestByTopic.entries())
        .map(([topic, entry]) => ({
          topic,
          value: entry.value,
          timeMs: entry.timeMs,
        }))
        .sort((a, b) => a.topic.localeCompare(b.topic))
    : [];

  $: rawFilterLc = rawFilter.trim().toLowerCase();
  $: rawFiltered =
    rawFilterLc === ""
      ? rawEntries
      : rawEntries.filter((r) => r.topic.toLowerCase().includes(rawFilterLc));
  $: rawShown = rawFiltered.slice(0, MAX_RAW_ROWS);
  $: rawHidden = rawFiltered.length - rawShown.length;
</script>

<div class="flex flex-col gap-4">
  <!-- Tile grid: builtins + custom/override tiles, then the always-last +.
       Dimmed while disconnected so the frozen values read as stale in the body,
       not only in the shell's banner. -->
  <div
    class="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 transition-opacity"
    class:opacity-70={!$store.connected}
  >
    {#each visibleTiles as tile (tile.key)}
      {#if tile.tooltip}
        <Tooltip text={tile.tooltip} class="h-full">
          <StatTile
            label={tile.label}
            value={tile.display}
            kind={tile.valueKind === "text" ? "text" : "number"}
            points={tile.samples}
            noData={tile.valueKind === "empty"}
          />
        </Tooltip>
      {:else}
        <StatTile
          label={tile.label}
          value={tile.display}
          kind={tile.valueKind === "text" ? "text" : "number"}
          points={tile.samples}
          noData={tile.valueKind === "empty"}
        />
      {/if}
    {/each}

    <Tooltip text="Add metric tile" class="h-full">
      <button
        type="button"
        on:click={openAddEditor}
        aria-label="Add metric tile"
        class="flex h-full min-h-[76px] w-full flex-col items-center justify-center gap-1 rounded
          border border-dashed border-outline bg-elevation-1 text-secondary-text
          transition-colors hover:border-hovered hover:text-emphasis"
      >
        <Icon type="plus" size={22} />
      </button>
    </Tooltip>
  </div>

  <!-- Empty state: broker likely publishes no $SYS (or the sub was removed). -->
  {#if showEmptyState}
    <div
      class="flex flex-col gap-3 rounded border border-outline bg-elevation-1 p-4"
    >
      <span class="text-emphasis">No $SYS metrics seen yet</span>
      <p class="text-sm text-secondary-text">
        This broker may not publish <code>$SYS</code> health topics, or its
        <code>$SYS/#</code> subscription was removed. The observed-rate tiles
        above are measured by this client and keep working regardless. You can
        also pin any topic as a custom tile with the “+”.
      </p>
      {#if !hasSysSubscription}
        <div>
          <Button
            variant="secondary"
            iconType="plus"
            iconSize={16}
            disabled={addingSysSub}
            on:click={addSysSubscription}
          >
            {addingSysSub ? "Adding…" : "Add $SYS/# subscription"}
          </Button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Collapsible raw $SYS browser. -->
  <div class="flex flex-col rounded border border-outline bg-elevation-1">
    <button
      type="button"
      class="flex items-center gap-2 px-3 py-2 text-secondary-text transition-colors hover:text-emphasis"
      on:click={() => (rawExpanded = !rawExpanded)}
      aria-expanded={rawExpanded}
    >
      <span
        class="inline-flex transition-transform {rawExpanded ? 'rotate-90' : ''}"
      >
        <Icon type="right" size={16} />
      </span>
      <span>Raw $SYS topics</span>
      <span class="text-sm opacity-70">({$store.latestByTopic.size})</span>
    </button>

    {#if rawExpanded}
      <div class="flex flex-col gap-2 border-t border-outline p-3">
        <BaseInput
          name="raw-sys-filter"
          label="Filter topics"
          icon="search"
          bind:value={rawFilter}
        />

        {#if rawShown.length === 0}
          <span class="px-1 py-4 text-sm text-secondary-text">
            {rawEntries.length === 0
              ? "No $SYS topics received yet."
              : "No topics match the filter."}
          </span>
        {:else}
          <div class="max-h-[320px] overflow-auto">
            <table class="w-full border-collapse text-sm">
              <thead>
                <tr class="text-left text-secondary-text">
                  <th class="py-1 pr-3 font-normal">Topic</th>
                  <th class="py-1 pr-3 font-normal">Latest</th>
                  <th class="py-1 pr-3 font-normal">Age</th>
                  <th class="py-1 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {#each rawShown as row (row.topic)}
                  <tr class="border-t border-divider align-middle">
                    <td class="max-w-[220px] truncate py-1 pr-3 text-emphasis">
                      {row.topic}
                    </td>
                    <td
                      class="max-w-[180px] truncate py-1 pr-3 font-mono tabular-nums text-secondary-text"
                    >
                      {row.value}
                    </td>
                    <td class="whitespace-nowrap py-1 pr-3 text-secondary-text">
                      {formatAge($nowTick, row.timeMs)}
                    </td>
                    <td class="py-1 text-right">
                      <IconButton
                        tooltipText="Pin as tile"
                        onClick={() => pinTopic(row.topic)}
                      >
                        <Icon type="plusSquare" size={16} />
                      </IconButton>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if rawHidden > 0}
            <span class="px-1 text-sm text-secondary-text opacity-70">
              {rawHidden} more hidden. Narrow the filter to see them.
            </span>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<MetricMappingEditor
  {connectionId}
  {store}
  isOpen={editorOpen}
  prefill={editorPrefill}
/>
