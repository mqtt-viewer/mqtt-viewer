<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import type { UpdateResponse } from "bindings/mqtt-viewer/backend/update/models";
  import { parseReleaseNotes } from "./release-notes-parser";

  export let update: UpdateResponse;
  export let currentVersion: string;
  export let updating = false;
  export let onUpdate: () => void = () => {};
  export let onRemindLater: () => void = () => {};
  export let onSkip: () => void = () => {};
  export let onCopyCommand: () => void = () => {};

  // Versions arrive with or without the v prefix; render chips consistently.
  const withV = (version: string): string =>
    `v${version.trim().replace(/^v/i, "")}`;

  // Formatting lives in release-notes-parser.ts so it can be tested on its own.
  $: noteLines = update.release_notes
    ? parseReleaseNotes(update.release_notes)
    : [];
</script>

<div class="w-[460px] flex flex-col gap-4 mt-2">
  <p class="text-secondary-text break-words">
    {#if update.can_self_update}
      A new version of MQTT Viewer is ready to install.
    {:else}
      A new version of MQTT Viewer is available.
    {/if}
  </p>

  <div class="flex items-center gap-3">
    {#if currentVersion}
      <span
        class="rounded border border-divider bg-elevation-0 px-2 py-[2px] font-mono text-sm"
        >{withV(currentVersion)}</span
      >
      <span class="text-secondary-text flex items-center">
        <Icon type="arrowRight" size={16} />
      </span>
    {/if}
    <span
      class="rounded border border-primary bg-elevation-0 px-2 py-[2px] font-mono text-sm text-primary"
      >{withV(update.latest_version)}</span
    >
  </div>

  {#if noteLines.length > 0}
    <div class="flex flex-col gap-2">
      <span class="text-sm text-emphasis">What's changed</span>
      <div
        class="max-h-[200px] overflow-y-auto rounded border border-divider bg-elevation-0 p-3 text-secondary-text text-base break-words flex flex-col gap-1"
      >
        {#each noteLines as line, i}
          {#if line.kind === "heading"}
            <span
              class={`text-emphasis whitespace-pre-wrap break-words ${
                i > 0 ? "mt-1" : ""
              }`}>{line.text}</span
            >
          {:else if line.kind === "bullet"}
            <span class="flex gap-2">
              <span class="text-secondary-text select-none">•</span>
              <span class="min-w-0 whitespace-pre-wrap break-words"
                >{line.text}</span
              >
            </span>
          {:else}
            <span class="whitespace-pre-wrap break-words">{line.text}</span>
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  {#if !update.can_self_update}
    {#if update.instructions}
      <p class="text-secondary-text break-words">{update.instructions}</p>
    {/if}
    {#if update.update_command}
      <div class="flex items-center gap-2">
        <code
          class="flex-1 select-all overflow-x-auto rounded border border-outline bg-elevation-2 px-3 py-2 font-mono text-sm text-emphasis"
          >{update.update_command}</code
        >
        <!-- With no releases page to open, Copy is the only affirmative
             action, so it takes the primary slot. -->
        <Button
          on:click={onCopyCommand}
          variant={update.releases_url ? "secondary" : "primary"}>Copy</Button
        >
      </div>
    {/if}
  {/if}

  <div class="flex items-center gap-3 mt-2">
    <Button variant="text" on:click={onSkip}>Skip this version</Button>
    <div class="grow"></div>
    <Button variant="secondary" on:click={onRemindLater}>Remind me later</Button>
    {#if update.can_self_update}
      <Button
        variant="primary"
        iconType="download"
        iconSize={16}
        disabled={updating}
        data-update-primary-focus
        on:click={onUpdate}>Update now</Button
      >
    {:else if update.releases_url}
      <Button
        variant="primary"
        data-update-primary-focus
        on:click={onUpdate}>Open releases page</Button
      >
    {/if}
  </div>
</div>
