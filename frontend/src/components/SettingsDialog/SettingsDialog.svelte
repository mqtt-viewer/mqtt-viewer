<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseNumberInput from "@/components/InputFields/BaseNumberInput.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import {
    GetAppSettings,
    UpdateAppSettings,
    GetDatabaseSizeBytes,
    ClearReceivedMessages,
    GetMemoryStats,
    GetMemoryLimitModel,
  } from "bindings/mqtt-viewer/backend/app/app";
  import env from "@/stores/env";
  import { whatsNewOpen } from "@/components/WhatsNewDialog/WhatsNewDialog.svelte";
  import { starPromptOpen } from "@/components/StarPromptDialog/StarPromptDialog.svelte";
  import {
    MB,
    GB,
    MIN_MEMORY_MB,
    EXAMPLE_CONNECTION_COUNTS,
    formatBytes,
    estimateTotalBytes,
    type MemoryLimitModel,
  } from "@/util/memory-budget";

  export let open = writable(false);

  let memoryBudgetMb = 512;
  let recordingEnabled = false;
  let diskBudgetGb = 1;
  let dbSizeBytes: number | undefined = undefined;
  let historyBytes: number | undefined = undefined;
  let limitModel: MemoryLimitModel | undefined;
  let isSaving = false;
  let isClearing = false;

  const recordingChecked = writable(false);

  const refreshMemoryStats = async () => {
    try {
      const stats = await GetMemoryStats();
      historyBytes = stats.historyBytes;
    } catch (e) {
      console.error("Failed to read memory stats", e);
      historyBytes = undefined;
    }
  };

  // Poll memory stats while the dialog is open so the readout stays live.
  let memoryPollInterval: ReturnType<typeof setInterval> | undefined;
  const startMemoryPolling = () => {
    if (memoryPollInterval !== undefined) return;
    refreshMemoryStats();
    memoryPollInterval = setInterval(refreshMemoryStats, 2000);
  };
  const stopMemoryPolling = () => {
    if (memoryPollInterval !== undefined) {
      clearInterval(memoryPollInterval);
      memoryPollInterval = undefined;
    }
  };
  onDestroy(stopMemoryPolling);

  const refreshDbSize = async () => {
    try {
      dbSizeBytes = await GetDatabaseSizeBytes();
    } catch (e) {
      console.error("Failed to read database size", e);
      dbSizeBytes = undefined;
    }
  };

  const loadSettings = async () => {
    try {
      const settings = await GetAppSettings();
      memoryBudgetMb = Math.max(
        MIN_MEMORY_MB,
        Math.round(settings.memoryBudgetBytes / MB)
      );
      recordingEnabled = settings.recordingEnabled;
      recordingChecked.set(settings.recordingEnabled);
      diskBudgetGb =
        Math.round((settings.diskBudgetBytes / GB) * 100) / 100 || 1;
    } catch (e) {
      console.error("Failed to load app settings", e);
      addToast({
        data: {
          title: "Settings",
          description: "Could not load settings",
          type: "error",
        },
      });
    }

    // Not fatal: the estimate falls back to a placeholder without it.
    try {
      limitModel = await GetMemoryLimitModel();
    } catch (e) {
      console.error("Failed to read the memory limit model", e);
    }
  };

  // Load fresh settings + db size whenever the dialog opens, and poll memory
  // stats only while it stays open.
  $: if ($open) {
    loadSettings();
    refreshDbSize();
    startMemoryPolling();
  } else {
    stopMemoryPolling();
  }

  // A cleared Svelte number input binds null, which is also invalid.
  $: memoryBelowMin = memoryBudgetMb == null || memoryBudgetMb < MIN_MEMORY_MB;

  const onRecordingChange = (checked: boolean) => {
    recordingEnabled = checked;
  };

  const onSave = async () => {
    isSaving = true;
    try {
      await UpdateAppSettings({
        memoryBudgetBytes: Math.max(MIN_MEMORY_MB, memoryBudgetMb ?? 0) * MB,
        recordingEnabled,
        diskBudgetBytes: Math.max(0, diskBudgetGb ?? 0) * GB,
        hasSeenHistoryPrompt: true,
      });
      addToast({
        data: {
          title: "Settings",
          description: "Settings saved",
          type: "success",
        },
      });
      open.set(false);
    } catch (e) {
      console.error("Failed to save app settings", e);
      addToast({
        data: {
          title: "Settings",
          description: "Could not save settings",
          type: "error",
        },
      });
    } finally {
      isSaving = false;
    }
  };

  const onClearHistory = async () => {
    isClearing = true;
    try {
      await ClearReceivedMessages(0);
      await refreshDbSize();
      addToast({
        data: {
          title: "History",
          description: "Recorded history cleared",
          type: "success",
        },
      });
    } catch (e) {
      console.error("Failed to clear recorded history", e);
      addToast({
        data: {
          title: "History",
          description: "Could not clear history",
          type: "error",
        },
      });
    } finally {
      isClearing = false;
    }
  };
</script>

<Dialog title="Settings" isOpen={open}>
  <div class="flex flex-col gap-5 mt-3 pt-3 w-[440px]">
    <section class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <BaseNumberInput
          name="memory-budget"
          label="Memory budget (MB)"
          min={MIN_MEMORY_MB}
          class="mb-[17px]"
          hasError={memoryBelowMin}
          errorMessage={memoryBelowMin ? "64 MB is the minimum" : undefined}
          bind:value={memoryBudgetMb}
        />

        <p class="text-sm text-secondary-text">
          With this budget, expect up to about:
        </p>
        <ul
          class="grid grid-cols-[max-content_auto] gap-x-3 text-sm text-secondary-text"
        >
          {#each EXAMPLE_CONNECTION_COUNTS as count}
            <li class="contents">
              <span>{count} connection{count === 1 ? "" : "s"}:</span>
              <span
                >{formatBytes(
                  estimateTotalBytes(
                    limitModel,
                    memoryBudgetMb ?? MIN_MEMORY_MB,
                    count
                  )
                )}</span
              >
            </li>
          {/each}
          <li>etc...</li>
        </ul>
      </div>

      <div class="flex flex-col gap-2">
        <Switch
          name="recording-enabled"
          label="Record history to disk"
          checked={recordingChecked}
          checkedBool={recordingEnabled}
          onChange={onRecordingChange}
        />
        <p class="text-sm text-secondary-text">
          Durable history survives restarts and is bounded by the disk budget
          below.
        </p>
      </div>

      <div class="flex flex-col gap-1 mt-3">
        <BaseNumberInput
          name="disk-budget"
          label="Disk budget (GB)"
          min={0}
          disabled={!recordingEnabled}
          bind:value={diskBudgetGb}
        />
      </div>
    </section>

    <section class="flex flex-col gap-3 border-t border-outline pt-4">
      <div class="flex items-center justify-between">
        <span class="text-secondary-text"
          >History in memory: {formatBytes(historyBytes)}</span
        >
      </div>
      <div class="flex items-center justify-between">
        <span class="text-secondary-text"
          >Database size: {formatBytes(dbSizeBytes)}</span
        >
        <Button variant="text" disabled={isClearing} on:click={onClearHistory}>
          {isClearing ? "Clearing…" : "Clear recorded history"}
        </Button>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-secondary-text">MQTT Viewer {$env.version}</span>
        <Button
          variant="text"
          on:click={() => {
            open.set(false);
            whatsNewOpen.set(true);
          }}>What's new</Button
        >
      </div>
      <div class="flex items-center justify-between">
        <span class="text-secondary-text">Like the app?</span>
        <Button
          variant="text"
          on:click={() => {
            open.set(false);
            starPromptOpen.set(true);
          }}>Star on GitHub</Button
        >
      </div>
    </section>

    <div class="flex gap-3 justify-end items-center">
      <Button variant="text" on:click={() => open.set(false)}>Cancel</Button>
      <Button
        variant="primary"
        disabled={isSaving || memoryBelowMin}
        on:click={onSave}
      >
        {isSaving ? "Saving…" : "Save"}
      </Button>
    </div>
  </div>
</Dialog>
