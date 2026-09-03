<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseNumberInput from "@/components/InputFields/BaseNumberInput.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import MemoryFormula from "@/components/MemoryFormula/MemoryFormula.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import {
    GetAppSettings,
    UpdateAppSettings,
  } from "bindings/mqtt-viewer/backend/app/app";
  import { firstRunGateCleared } from "@/components/WhatsNewDialog/WhatsNewDialog.svelte";
  import { MB, GB, MIN_MEMORY_MB } from "@/util/memory-budget";

  const isOpen = writable(false);

  let memoryBudgetMb = 512;
  let recordingEnabled = false;
  let diskBudgetGb = 1;
  let isSaving = false;
  let wasShown = false;

  const recordingChecked = writable(false);

  // A cleared Svelte number input binds null, which is also invalid.
  $: memoryBelowMin = memoryBudgetMb == null || memoryBudgetMb < MIN_MEMORY_MB;

  onMount(async () => {
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
      I cap how much message history I keep in memory so long sessions don't
      eat your RAM. You can also record history to disk so it survives
      restarts.
    </p>

    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1.5 pt-4">
        <BaseNumberInput
          name="prompt-memory-budget"
          label="Memory budget per connection (MB)"
          min={MIN_MEMORY_MB}
          hasError={memoryBelowMin}
          bind:value={memoryBudgetMb}
        />
        {#if memoryBelowMin}
          <p class="text-sm text-error">{MIN_MEMORY_MB} MB is the minimum</p>
        {/if}
        <MemoryFormula budgetMb={memoryBudgetMb} />
      </div>

      <Switch
        name="prompt-recording-enabled"
        label="Record history to disk"
        checked={recordingChecked}
        checkedBool={recordingEnabled}
        onChange={onRecordingChange}
      />

      <div class="flex flex-col gap-1.5 pt-4">
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
