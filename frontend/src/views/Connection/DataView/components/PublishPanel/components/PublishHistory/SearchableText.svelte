<script lang="ts">
  import {
    calculateDisplayText,
    type TruncateConfig,
  } from "./calculateDisplayText";

  export let text: string = "";
  export let syntaxHighlight = false;
  export let isTopic: boolean = false;
  export let searchTerm: string = "";
  export let config: TruncateConfig = {
    contextChars: 40,
    maxDisplayChars: 80,
  };

  $: ({ displayText, showEllipsisStart, showEllipsisEnd } =
    calculateDisplayText(text, searchTerm, config));
</script>

<div class="relative w-full min-w-0">
  <p class="whitespace-nowrap overflow-hidden">
    {#if showEllipsisStart}
      <span class="font-sans">...</span>
    {/if}

    {#if searchTerm && displayText
        .toLowerCase()
        .includes(searchTerm.toLowerCase())}
      {#each displayText.split(new RegExp(`(${searchTerm})`, "i")) as part}
        {@const readable = isTopic ? part?.split("/").join(" / ") : part}
        {#if part.toLowerCase() === searchTerm.toLowerCase()}
          <span class="font-bold text-[#9890FF] bg-[#9890FF25]">{readable}</span
          >
        {:else}
          <span class="text-secondary-text">{readable}</span>
        {/if}
      {/each}
    {:else}
      {@const readable = isTopic
        ? displayText?.split("/").join(" / ")
        : displayText}
      <span class="text-secondary-text">
        {readable}
      </span>
    {/if}

    {#if showEllipsisEnd}
      <span class="font-sans">...</span>
    {/if}
  </p>
</div>
