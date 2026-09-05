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
    GetMemoryLimitModel,
  } from "bindings/mqtt-viewer/backend/app/app";
  import { firstRunGateCleared } from "@/components/WhatsNewDialog/WhatsNewDialog.svelte";
  import {
    estimateRetentionSeconds,
    formatRetentionDuration,
  } from "./retention-estimates";
  import {
    MB,
    GB,
    MIN_MEMORY_MB,
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

  // Mirror the byte conversion onSave uses so the estimates match what will
  // actually be saved.
  $: estimateBudgetBytes = Math.max(0, diskBudgetGb ?? 0) * GB;

  const usageProfiles = [
    { label: "Heavy", detail: "about 1,000 msg/s", messagesPerSecond: 1000 },
    { label: "Medium", detail: "about 100 msg/s", messagesPerSecond: 100 },
    { label: "Light", detail: "about 10 msg/s", messagesPerSecond: 10 },
  ];

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
        <MemoryFormula budgetMb={memoryBudgetMb} {limitModel} />
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
        {#if recordingEnabled}
          <div
            class="flex flex-col gap-1.5 mt-2 p-3 rounded bg-elevation-1 text-sm text-secondary-text"
          >
            <p class="text-emphasis">History kept for one connection</p>
            {#each usageProfiles as profile}
              <div class="flex items-baseline justify-between gap-3">
                <span
                  >{profile.label}
                  <span class="text-xs">({profile.detail})</span></span
                >
                <span class="whitespace-nowrap text-emphasis"
                  >{formatRetentionDuration(
                    estimateRetentionSeconds(
                      estimateBudgetBytes,
                      profile.messagesPerSecond
                    )
                  )}</span
                >
              </div>
            {/each}
            <p class="mt-1 text-xs">
              Estimates assume small messages of a few hundred bytes. You can
              change this any time in settings.
            </p>
          </div>
        {/if}
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
