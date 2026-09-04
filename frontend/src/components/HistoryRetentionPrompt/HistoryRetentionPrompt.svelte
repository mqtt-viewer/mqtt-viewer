<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseNumberInput from "@/components/InputFields/BaseNumberInput.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import {
    GetAppSettings,
    UpdateAppSettings,
    GetMemoryLimitModel,
  } from "bindings/mqtt-viewer/backend/app/app";
  import { firstRunGateCleared } from "@/components/WhatsNewDialog/WhatsNewDialog.svelte";
  import {
    MB,
    GB,
    MIN_MEMORY_MB,
    EXAMPLE_CONNECTION_COUNTS,
    formatBytes,
    estimateTotalBytes,
    type MemoryLimitModel,
  } from "@/util/memory-budget";

  const isOpen = writable(false);

  let memoryBudgetMb = 512;
  let recordingEnabled = false;
  let diskBudgetGb = 1;
  let isSaving = false;
  let wasShown = false;
  let limitModel: MemoryLimitModel | undefined;

  const recordingChecked = writable(false);

  // A cleared Svelte number input binds null, which is also invalid.
  $: memoryBelowMin = memoryBudgetMb == null || memoryBudgetMb < MIN_MEMORY_MB;

  onMount(async () => {
    // Deliberately not awaited: this only feeds an estimate, so a slow or
    // hanging call must never hold up the prompt or the first-run gate behind
    // it. The copy shows a placeholder until it lands, and nothing if it fails.
    GetMemoryLimitModel()
      .then((model) => {
        limitModel = model;
      })
      .catch((e) => console.error("Failed to read the memory limit model", e));

    try {
      const settings = await GetAppSettings();
      if (!settings.hasSeenHistoryPrompt) {
        // Pre-fill with current (default-seeded) values.
        memoryBudgetMb =
          Math.round(settings.memoryBudgetBytes / MB) || 512;
        recordingEnabled = settings.recordingEnabled;
        recordingChecked.set(settings.recordingEnabled);
        diskBudgetGb =
          Math.round((settings.diskBudgetBytes / GB) * 100) / 100 || 1;
        wasShown = true;
        isOpen.set(true);
      } else {
        // No prompt needed — the What's New dialog may show straight away.
        firstRunGateCleared.set(true);
      }
    } catch (e) {
      console.error("Failed to load app settings for history prompt", e);
      firstRunGateCleared.set(true);
    }
  });

  const onRecordingChange = (checked: boolean) => {
    recordingEnabled = checked;
  };

  // Runs on every close path (Escape, overlay click, or after apply) via the
  // Dialog's onClose. The Dialog invokes onClose once during init because the
  // store starts false, so no-op until the prompt has actually been shown.
  // Deliberately does not persist hasSeenHistoryPrompt: dismissing without
  // choosing should re-prompt on the next launch.
  const handleClosed = () => {
    if (!wasShown) return;
    firstRunGateCleared.set(true);
  };

  // Persist the chosen (or default) values and mark the prompt as seen so it
  // never shows again, then close.
  const apply = async (params: {
    memoryBudgetBytes: number;
    recordingEnabled: boolean;
    diskBudgetBytes: number;
  }) => {
    isSaving = true;
    try {
      await UpdateAppSettings({
        ...params,
        hasSeenHistoryPrompt: true,
      });
    } catch (e) {
      console.error("Failed to save history retention settings", e);
      addToast({
        data: {
          title: "Settings",
          description: "Could not save settings",
          type: "error",
        },
      });
    } finally {
      isSaving = false;
      isOpen.set(false);
      firstRunGateCleared.set(true);
    }
  };

  const onSave = () =>
    apply({
      memoryBudgetBytes: Math.max(MIN_MEMORY_MB, memoryBudgetMb ?? 0) * MB,
      recordingEnabled,
      diskBudgetBytes: Math.max(0, diskBudgetGb ?? 0) * GB,
    });

  const onNotNow = () =>
    apply({
      memoryBudgetBytes: 512 * MB,
      recordingEnabled: false,
      diskBudgetBytes: 1 * GB,
    });
</script>

<Dialog
  title="Message history retention"
  {isOpen}
  onClose={handleClosed}
  showCloseButton={false}
>
  <div class="flex flex-col gap-5 mt-3 w-[440px]">
    <p class="text-secondary-text">
      You can decide how much memory MQTT Viewer uses.
    </p>

    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <BaseNumberInput
          name="prompt-memory-budget"
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
          name="prompt-recording-enabled"
          label="Record history to disk"
          checked={recordingChecked}
          checkedBool={recordingEnabled}
          onChange={onRecordingChange}
        />
      </div>

      <div class="flex flex-col gap-1 mt-3">
        <BaseNumberInput
          name="prompt-disk-budget"
          label="Disk budget (GB)"
          min={0}
          disabled={!recordingEnabled}
          bind:value={diskBudgetGb}
        />
      </div>
    </div>

    <div class="flex gap-3 justify-end items-center">
      <Button variant="text" disabled={isSaving} on:click={onNotNow}
        >Not now</Button
      >
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
