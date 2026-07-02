<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseNumberInput from "@/components/InputFields/BaseNumberInput.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { writable } from "svelte/store";
  import {
    GetAppSettings,
    UpdateAppSettings,
    GetDatabaseSizeBytes,
    ClearReceivedMessages,
  } from "bindings/mqtt-viewer/backend/app/app";
  import env from "@/stores/env";
  import { whatsNewOpen } from "@/components/WhatsNewDialog/WhatsNewDialog.svelte";

  export let open = writable(false);

  const MB = 1024 * 1024;
  const GB = 1024 * 1024 * 1024;
  const MIN_MEMORY_MB = 64;

  let memoryBudgetMb = 512;
  let recordingEnabled = false;
  let diskBudgetGb = 1;
  let dbSizeBytes: number | undefined = undefined;
  let isSaving = false;
  let isClearing = false;

  const recordingChecked = writable(false);

  // Human-readable byte formatting (e.g. "240 MB", "1.2 GB").
  const formatBytes = (bytes: number | undefined): string => {
    if (bytes === undefined) return "…";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${units[unitIndex]}`;
  };

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
  };

  // Load fresh settings + db size whenever the dialog opens.
  $: if ($open) {
    loadSettings();
    refreshDbSize();
  }

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
  <div class="flex flex-col gap-5 mt-3 w-[440px]">
    <section class="flex flex-col gap-4">
      <h3 class="text-emphasis font-medium">Message retention</h3>

      <div class="flex flex-col gap-1">
        <BaseNumberInput
          name="memory-budget"
          label="Memory budget (MB)"
          min={MIN_MEMORY_MB}
          bind:value={memoryBudgetMb}
        />
        <p class="text-sm text-secondary-text">
          Bounds in-memory message history so long subscriptions don't grow RAM
          without limit. Always on.
        </p>
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

      <div class="flex flex-col gap-1">
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
          >Database size: {formatBytes(dbSizeBytes)}</span
        >
        <Button
          variant="text"
          disabled={isClearing}
          on:click={onClearHistory}
        >
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
    </section>

    <div class="flex gap-3 justify-end items-center">
      <Button variant="text" on:click={() => open.set(false)}>Cancel</Button>
      <Button variant="primary" disabled={isSaving} on:click={onSave}>
        {isSaving ? "Saving…" : "Save"}
      </Button>
    </div>
  </div>
</Dialog>
