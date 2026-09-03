<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import moment from "moment";
  import _ from "lodash";
  import { Events } from "@wailsio/runtime";
  //@ts-ignore
  import VirtualList from "@sveltejs/svelte-virtual-list";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import { copyToClipboard } from "@/util/copy";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import type { Connection } from "@/stores/connections";
  import {
    GetConnectionLogs,
    ClearConnectionLogs,
    SetConnectionDebugLogging,
    SetLogsStreaming,
  } from "bindings/mqtt-viewer/backend/app/app";
  import type { LogEntry } from "bindings/mqtt-viewer/backend/mqtt/models";

  export let isOpen: Writable<boolean>;
  export let connection: Connection;

  // Client-side ceiling; the server ring is bounded at 2000, but live batches
  // accumulate on top of the initial snapshot, so trim to keep memory bounded.
  const MAX_ENTRIES = 5000;

  type Level = "debug" | "info" | "warn" | "error";
  const LEVELS: Level[] = ["debug", "info", "warn", "error"];

  // Stable per-entry identity: a monotonic uid assigned on arrival, so list
  // rows keep their identity as the window slides.
  type UiLogEntry = LogEntry & { uid: number };
  let nextUid = 0;
  const withUids = (batch: LogEntry[]): UiLogEntry[] =>
    batch.map((e) => ({ ...e, uid: nextUid++ }));

  $: details = connection?.connectionDetails;

  let entries: UiLogEntry[] = [];
  // The Switch's checked state, shared with melt so a failed toggle can be
  // rolled back programmatically. Read straight from the prop — the reactive
  // `details` hasn't been assigned yet when this top-level initialiser runs.
  const debugChecked = writable(
    connection?.connectionDetails?.debugLoggingEnabled ?? false
  );

  // Filters
  let filterText = "";
  let debouncedFilter = "";
  const syncFilter = _.debounce((q: string) => (debouncedFilter = q), 120);
  $: syncFilter(filterText);
  let levelEnabled: Record<Level, boolean> = {
    debug: true,
    info: true,
    warn: true,
    error: true,
  };

  $: filtered = entries.filter((e) => {
    if (!levelEnabled[(e.level as Level) ?? "info"]) return false;
    if (!debouncedFilter.trim()) return true;
    return e.message.toLowerCase().includes(debouncedFilter.trim().toLowerCase());
  });

  // --- live subscription tied to open state -------------------------------
  let off: (() => void) | null = null;
  let streamingOn = false;
  let lastOpen = false;
  $: if ($isOpen !== lastOpen) {
    lastOpen = $isOpen;
    if ($isOpen) void onOpen();
    else onClose();
  }

  const onOpen = async () => {
    if (!details) return;
    const id = details.id;
    // Re-seed the toggle from the latest persisted value on each open.
    debugChecked.set(details.debugLoggingEnabled ?? false);
    // Snapshot first: it drains the server's pending queue, so every batch
    // emitted after streaming starts contains only post-snapshot lines.
    // Enabling streaming before the snapshot could put a batch on the wire
    // whose lines the snapshot already includes.
    let snapshot: LogEntry[] = [];
    try {
      snapshot = await GetConnectionLogs(id);
    } catch (e) {
      snapshot = [];
    }
    // The dialog may have been closed (or the component destroyed) while the
    // snapshot was in flight; don't install a listener that would outlive it.
    if (!$isOpen || destroyed) return;
    entries = withUids(snapshot);
    autoScroll = true;
    off?.();
    const logsEvent = connection?.eventSet?.mqttLogs;
    if (logsEvent) {
      off = Events.On(logsEvent, (e: any) => {
        const batch: LogEntry[] = e.data ?? [];
        if (!batch.length) return;
        appendBatch(batch);
      });
    }
    try {
      await SetLogsStreaming(id, true);
      streamingOn = true;
    } catch (e) {
      // Snapshot still works; only the live feed is lost.
    }
    if (!$isOpen || destroyed) {
      stopStreaming();
      off?.();
      off = null;
      return;
    }
    void scrollToBottom();
  };

  const appendBatch = (batch: LogEntry[]) => {
    // Decide re-pin from the position BEFORE the append mutates the list.
    const pinned = autoScroll;
    const next = [...entries, ...withUids(batch)];
    entries =
      next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    if (pinned) void scrollToBottom();
  };

  const stopStreaming = () => {
    if (!streamingOn || !details) return;
    streamingOn = false;
    SetLogsStreaming(details.id, false).catch(() => {});
  };

  const onClose = () => {
    off?.();
    off = null;
    stopStreaming();
  };

  // Ensure the live subscription and server-side streaming are dropped if the
  // dialog unmounts while open.
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
    onClose();
  });

  // --- auto-scroll --------------------------------------------------------
  // The virtual list owns its scroll container; find it inside our wrapper and
  // listen with capture since scroll events don't bubble.
  let listWrapEl: HTMLDivElement | null = null;
  let autoScroll = true;
  const PIN_THRESHOLD_PX = 40;
  const getViewport = (): HTMLElement | null =>
    listWrapEl?.querySelector("svelte-virtual-list-viewport") ?? null;
  // The virtual list re-estimates row heights and fires scroll events of its
  // own, so a scroll event alone can't distinguish the user from the library.
  // Only a recent user gesture (wheel, touch, scrollbar drag, keys) may pause
  // the tail; returning to the bottom always re-arms it.
  let userScrollIntentAt = 0;
  const markUserIntent = () => (userScrollIntentAt = performance.now());
  const onScrollCapture = () => {
    const vp = getViewport();
    if (!vp) return;
    const gap = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
    if (gap < PIN_THRESHOLD_PX) {
      autoScroll = true;
    } else if (performance.now() - userScrollIntentAt < 500) {
      autoScroll = false;
    }
  };
  const scrollToBottom = async () => {
    // Multiple passes: the virtual list estimates unrendered row heights, so
    // each scroll can land short until the tail is actually rendered.
    for (let i = 0; i < 5; i++) {
      await tick();
      const vp = getViewport();
      if (!vp) return;
      vp.scrollTop = vp.scrollHeight;
      if (vp.scrollHeight - vp.scrollTop - vp.clientHeight < PIN_THRESHOLD_PX)
        break;
    }
  };

  // --- actions ------------------------------------------------------------
  const onToggleDebug = async (next: boolean) => {
    if (!details) {
      debugChecked.set(!next);
      return;
    }
    try {
      await SetConnectionDebugLogging(details.id, next);
      // Keep the in-memory connection details in sync so a reopen is accurate.
      details.debugLoggingEnabled = next;
    } catch (e) {
      // Roll the switch back so its visual state matches reality.
      debugChecked.set(!next);
      addToast({
        data: {
          title: "Failed to update debug logging",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const formatLine = (e: LogEntry) =>
    `[${moment(e.timestampMs).format("HH:mm:ss.SSS")}] ${(e.level ?? "").toUpperCase().padEnd(5)} ${e.message}`;

  const onCopy = async () => {
    if (filtered.length === 0) return;
    try {
      await copyToClipboard(filtered.map(formatLine).join("\n"));
    } catch (e) {
      addToast({
        data: {
          title: "Failed to copy logs",
          description: e as string,
          type: "error",
        },
      });
      return;
    }
    addToast({
      data: {
        title: "Logs copied",
        description: `${filtered.length} line${filtered.length === 1 ? "" : "s"} copied to clipboard`,
        type: "success",
      },
    });
  };

  const onClear = async () => {
    if (!details) return;
    try {
      await ClearConnectionLogs(details.id);
      entries = [];
    } catch (e) {
      addToast({
        data: {
          title: "Failed to clear logs",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const levelColor = (level: string): string => {
    switch (level) {
      case "error":
        return "text-error";
      case "warn":
        return "text-warning";
      case "debug":
        return "text-secondary-text";
      default:
        return "text-white-text";
    }
  };
</script>

<Dialog {isOpen} startEmpty>
  <div class="flex flex-col w-[760px] max-w-[92vw] h-[70vh] max-h-[80vh] min-h-0">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 pt-4 pb-3">
      <Icon type="bug" size={16} />
      <div class="flex flex-col min-w-0">
        <span class="text-lg text-emphasis truncate">Client logs</span>
        <span class="text-sm text-secondary-text truncate"
          >{details?.name ?? ""}</span
        >
      </div>
      <div class="grow"></div>
      <Switch
        name="debug-logging"
        label="Debug logging"
        checked={debugChecked}
        onChange={onToggleDebug}
      />
      <IconButton onClick={() => isOpen.set(false)}>
        <Icon type="close" size={16} />
      </IconButton>
    </div>

    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-4 pb-3">
      <div class="w-[260px]">
        <BaseInput
          bind:value={filterText}
          name="filter-logs"
          icon="search"
          placeholder="Filter logs"
        />
      </div>
      <div class="flex items-center gap-1">
        {#each LEVELS as level}
          <button
            class={`px-2 py-[3px] rounded text-xs font-mono uppercase border transition-colors ${
              levelEnabled[level]
                ? `${levelColor(level)} border-divider bg-elevation-2`
                : "text-secondary-text/50 border-transparent"
            }`}
            on:click={() => (levelEnabled[level] = !levelEnabled[level])}
          >
            {level}
          </button>
        {/each}
      </div>
      <div class="grow"></div>
      <Button variant="text" iconType="copy" iconSize={15} on:click={onCopy}>
        Copy
      </Button>
      <Button
        variant="text"
        iconType="delete"
        iconSize={15}
        class="hover:text-error"
        on:click={onClear}
      >
        Clear
      </Button>
    </div>

    <!-- Log body -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      bind:this={listWrapEl}
      on:scroll|capture={onScrollCapture}
      on:wheel|capture={markUserIntent}
      on:touchstart|capture={markUserIntent}
      on:mousedown|capture={markUserIntent}
      on:keydown|capture={markUserIntent}
      class="grow min-h-0 overflow-hidden mx-4 mb-4 rounded bg-elevation-0 border border-divider py-1 font-mono text-sm leading-relaxed"
    >
      {#if filtered.length === 0}
        <div class="h-full flex items-center justify-center text-secondary-text">
          {entries.length === 0
            ? "No logs yet"
            : "No logs match the current filter"}
        </div>
      {:else}
        <VirtualList items={filtered} let:item>
          <div class="flex gap-2 whitespace-pre-wrap break-words px-3">
            <span class="text-secondary-text shrink-0"
              >{moment(item.timestampMs).format("HH:mm:ss.SSS")}</span
            >
            <span class={`shrink-0 w-10 uppercase ${levelColor(item.level)}`}
              >{item.level}</span
            >
            <span class="text-white-text">{item.message}</span>
          </div>
        </VirtualList>
      {/if}
    </div>
  </div>
</Dialog>
