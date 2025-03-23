<script lang="ts">
  import IconButton from "@/components/Button/IconButton.svelte";
  import type { SupportCodeEditorCodec } from "@/components/CodeEditor/codec";
  import type { SupportedCodeEditorFormat } from "@/components/CodeEditor/formatting";
  import { highlightJson } from "@/components/CodeEditor/highlighter";
  import Icon from "@/components/Icon/Icon.svelte";
  import moment from "moment";
  import SearchableText from "./SearchableText.svelte";

  export let topic: string;
  export let payload: string;
  export let retain: boolean;
  export let timestamp: Date;
  export let searchString: string;
  export let encoding: SupportCodeEditorCodec;
  export let format: SupportedCodeEditorFormat;
  export let onClick: () => void;
  export let onCrossClick: () => void;

  $: syntaxHighlightedMessage = !!payload ? highlightJson(payload) : "";
  $: tags = [encoding]
    .filter((tag) => tag !== "none")
    .map((tag) => {
      // if (tag === "json" || tag === "json-prettier") {
      //   return "JSON";
      // }
      if (tag === "base64") {
        return "Base64";
      }
      if (tag === "hex") {
        return "Hex";
      }
    });

  $: countTags = tags.length + (retain ? 1 : 0);
  $: readableTopic = topic.split("/").join(" / ");
</script>

<div class="relative max-w-full">
  <button
    class="text-white-text pl-[7px] pr-2 py-3 text-left hover:bg-hovered w-full"
    on:click={onClick}
  >
    <div class="flex items-center">
      <div class="mr-2 ml-[3px]">
        <Icon type="history" size={16} />
      </div>
      <div class="grow min-w-0 space-y-1">
        <div class="w-full flex gap-2">
          {#each tags as tag}
            <div
              class="font-mono text-sm leading-1 pt-[1px] border border-gray-700 px-1"
            >
              {tag}
            </div>
          {/each}
          {#if retain}
            <div
              class="text-secondary font-mono text-sm leading-1 pt-[1px] border border-gray-700 px-1"
            >
              Retain
            </div>
          {/if}
          <div class="truncate w-full grow min-w-0">
            {#if !searchString}
              {readableTopic}
            {:else}
              <SearchableText searchTerm={searchString} isTopic text={topic} />
            {/if}
          </div>
        </div>
        <div class="font-mono truncate">
          {#if !searchString}
            <span class="text-secondary-text">
              {@html syntaxHighlightedMessage}
            </span>
          {:else}
            <SearchableText
              searchTerm={searchString}
              text={payload}
              config={{
                contextChars: 30,
                maxDisplayChars: 50,
              }}
            />
          {/if}
        </div>
      </div>
      <div
        class="w-fit self-stretch flex items-center mr-7 ml-3 text-gray-400 whitespace-nowrap"
      >
        {moment(timestamp).fromNow()}
      </div>
    </div>
  </button>
  <IconButton
    class="absolute top-1/2 -translate-y-1/2 right-2"
    onClick={(e) => {
      e?.preventDefault();
      e?.stopImmediatePropagation();
      onCrossClick();
    }}
  >
    <Icon type="close" size={14} />
  </IconButton>
</div>
