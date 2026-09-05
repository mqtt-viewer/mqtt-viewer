<script lang="ts">
  import { openExternal } from "@/util/external";
  import Button from "@/components/Button/Button.svelte";
  import type { ChangelogEntry } from "@/changelog";
  import { groupSections } from "@/changelog-groups";

  // Newest first: entries[0] is shown leftmost, older versions to the right.
  export let entries: ChangelogEntry[] = [];
  // Which version's tab to open on first render (defaults to the newest).
  export let initialVersion: string | null = null;
  export let onClose: () => void = () => {};

  const STARGAZERS_URL = "https://github.com/mqtt-viewer/mqtt-viewer";

  const startIndex = (() => {
    const i = entries.findIndex((e) => e.version === initialVersion);
    return i === -1 ? 0 : i;
  })();
  let selectedIndex = startIndex;

  $: selectedIndex = Math.min(selectedIndex, Math.max(entries.length - 1, 0));
  $: entry = entries[selectedIndex];
  $: showTabs = entries.length > 1;
  // Sections under their group heading. An entry with no groups comes back as
  // a single unheaded bucket, so older releases look exactly as they did.
  $: groups = entry ? groupSections(entry.sections) : [];
  const tabLabel = (e: ChangelogEntry) =>
    e.released ? e.version : "Unreleased";
</script>

<div class="flex flex-col w-[480px] max-w-full">
  {#if showTabs}
    <div
      class="flex shrink-0 gap-1 relative -mt-1 mb-3 overflow-x-auto"
      role="tablist"
      aria-label="Releases"
    >
      <div class="absolute bottom-0 h-[1px] w-full bg-outline"></div>
      {#each entries as e, i (e.version)}
        <button
          role="tab"
          aria-selected={i === selectedIndex}
          class={`relative px-3 py-2 text-base whitespace-nowrap transition-colors hover:text-emphasis ${
            i === selectedIndex ? "text-emphasis" : "text-secondary-text"
          }`}
          on:click={() => (selectedIndex = i)}
        >
          {tabLabel(e)}
          {#if i === selectedIndex}
            <div
              class="absolute bottom-0 left-0 h-[1px] w-full rounded bg-primary"
            ></div>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if entry}
    <div class="flex flex-col gap-4 max-h-[56vh] overflow-y-auto pr-1">
      <span class="text-lg font-medium text-white-text">{entry.headline}</span>
      <p class="text-secondary-text">{entry.intro}</p>

      <div class="flex flex-col gap-4">
        {#each groups as bucket (bucket.group ?? "")}
          <div class="flex flex-col gap-3">
            {#if bucket.group}
              <span class="text-base font-medium text-emphasis"
                >{bucket.group}</span
              >
            {/if}
            {#each bucket.sections as section}
              <div
                class="flex flex-col gap-[2px] border-l-2 border-outline pl-3"
              >
                <span class="text-emphasis">{section.title}</span>
                {#if section.body || section.thanks?.length}
                  <span class="text-secondary-text text-base"
                    >{section.body}{#if section.thanks?.length}{section.body
                        ? " Thanks "
                        : "Thanks "}{#each section.thanks as t, i}{#if i > 0}{i ===
                          (section.thanks?.length ?? 0) - 1
                            ? " and "
                            : ", "}{/if}<a
                          href={t.url}
                          class="text-primary hover:underline"
                          on:click|preventDefault={() => openExternal(t.url)}
                          >@{t.name}</a
                        >{/each}.{/if}</span
                  >
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>

      {#if entry.outro}
        <p class="text-secondary-text">{entry.outro}</p>
      {/if}
    </div>

    <div class="flex justify-end items-center gap-3 mt-4">
      <span class="text-sm text-secondary-text grow">{entry.date}</span>
      <Button
        variant="secondary"
        on:click={() => openExternal(STARGAZERS_URL)}
      >
        Star on GitHub
      </Button>
      <Button variant="primary" on:click={onClose}>Nice, got it</Button>
    </div>
  {/if}
</div>
