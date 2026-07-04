<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import type { ChangelogEntry } from "@/changelog";

  export let entry: ChangelogEntry;
  export let onClose: () => void = () => {};
</script>

<div
  class="flex flex-col gap-4 mt-2 w-[480px] max-h-[60vh] overflow-y-auto pr-1"
>
  <p class="text-secondary-text">{entry.intro}</p>

  <div class="flex flex-col gap-3">
    {#each entry.sections as section}
      <div class="flex flex-col gap-[2px]">
        <span class="text-emphasis">{section.title}</span>
        <span class="text-secondary-text text-base">{section.body}</span>
      </div>
    {/each}
  </div>

  {#if entry.outro}
    <p class="text-secondary-text">{entry.outro}</p>
  {/if}

  <div class="flex justify-end items-center gap-3">
    <span class="text-sm text-secondary-text grow">{entry.date}</span>
    <Button variant="primary" on:click={onClose}>Nice, got it</Button>
  </div>
</div>
