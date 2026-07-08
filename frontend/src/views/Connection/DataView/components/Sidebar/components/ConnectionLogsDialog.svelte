<script lang="ts">
  import { afterUpdate } from "svelte";
  import type { Writable } from "svelte/store";
  import moment from "moment";
  import _ from "lodash";
  import { Events } from "@wailsio/runtime";
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
  } from "bindings/mqtt-viewer/backend/app/app";
  import type { LogEntry } from "bindings/mqtt-viewer/backend/mqtt/models";

  export let isOpen: Writable<boolean>;
  export let connection: Connection;

  // Client-side ceiling; the server ring is bounded at 2000, but live batches
  // accumulate on top of the initial snapshot, so trim to keep the DOM light.
  const MAX_ENTRIES = 5000;

  type Level = "debug" | "info" | "warn" | "error";
  const LEVELS: Level[] = ["debug", "info", "warn", "error"];

  $: details = connection.connectionDetails;

  let entries: LogEntry[] = [];
  let debugEnabled = details.debugLoggingEnabled ?? false;

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
  let lastOpen = false;
  $: if ($isOpen !== lastOpen) {
    lastOpen = $isOpen;
    if ($isOpen) void onOpen();
    else onClose();
  }

  const onOpen = async () => {
    // Re-seed the toggle from the latest persisted value on each open.
    debugEnabled = details.debugLoggingEnabled ?? false;
    try {
      entries = await GetConnectionLogs(details.id);
    } catch (e) {
      entries = [];
    }
    autoScroll = true;
    off?.();
    off = Events.On(connection.eventSet.mqttLogs, (e: any) => {
      const batch: LogEntry[] = e.data ?? [];
      if (!batch.length) return;
      const next = [...entries, ...batch];
      entries = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  };

  const onClose = () => {
    off?.();
    off = null;
  };

  // --- auto-scroll --------------------------------------------------------
  let scrollEl: HTMLDivElement | null = null;
  let autoScroll = true;
  const onScroll = () => {
    if (!scrollEl) return;
    autoScroll =
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 24;
  };
  afterUpdate(() => {
    if (autoScroll && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  // --- actions ------------------------------------------------------------
  const onToggleDebug = async (next: boolean) => {
    const prev = debugEnabled;
    debugEnabled = next;
    try {
      await SetConnectionDebugLogging(details.id, next);
      // Keep the in-memory connection details in sync so a reopen is accurate.
      details.debugLoggingEnabled = next;
    } catch (e) {
      debugEnabled = prev;
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
    await copyToClipboard(filtered.map(formatLine).join("\n"));
    addToast({
      data: {
        title: "Logs copied",
        description: `${filtered.length} line${filtered.length === 1 ? "" : "s"} copied to clipboard`,
        type: "success",
      },
    });
  };

  const onClear = async () => {
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
        <span class="text-sm text-secondary-text truncate">{details.name}</span>
      </div>
      <div class="grow"></div>
      <Switch
        name="debug-logging"
        label="Debug logging"
        defaultChecked={debugEnabled}
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
    <div
      bind:this={scrollEl}
      on:scroll={onScroll}
      class="grow min-h-0 overflow-y-auto mx-4 mb-4 rounded bg-elevation-0 border border-divider p-3 font-mono text-sm leading-relaxed"
    >
      {#if filtered.length === 0}
        <div class="h-full flex items-center justify-center text-secondary-text">
          {entries.length === 0
            ? "No logs yet"
            : "No logs match the current filter"}
        </div>
      {:else}
        {#each filtered as entry, i (i)}
          <div class="flex gap-2 whitespace-pre-wrap break-all">
            <span class="text-secondary-text shrink-0"
              >{moment(entry.timestampMs).format("HH:mm:ss.SSS")}</span
            >
            <span class={`shrink-0 w-10 uppercase ${levelColor(entry.level)}`}
              >{entry.level}</span
            >
            <span class="text-white-text">{entry.message}</span>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</Dialog>
