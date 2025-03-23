<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import { highlightJson } from "@/components/CodeEditor/highlighter";
  import Icon from "@/components/Icon/Icon.svelte";
  import ProtobufLogo from "@/components/ProtobufLogo/ProtobufLogo.svelte";
  import { onDestroy, tick } from "svelte";
  import { twMerge } from "tailwind-merge";
  import type { HighlightedMqttTopicsStore } from "../../stores/highlighted-topics";
  export let topic: string;
  export let topicLevel: string;
  export let expandKey: string;
  export let message: string | undefined;
  export let messageCount: number;
  export let subtopicCount: number;
  export let isExpanded: boolean;
  export let isSelected: boolean;
  export let isDecodedProto: boolean = false;
  export let toggleExpansion: (expandKey: string) => void;
  export let onTopicSelect: () => void;
  export let highlightedTopicStore: HighlightedMqttTopicsStore;

  $: syntaxHighlightedMessage = !!message ? highlightJson(message) : "";

  const FLASH_DURATION_MS = 1200;

  let flashClassRemoveTimeout: NodeJS.Timeout | null;
  let highlightAnimation: string | null = null;
  let highlightDelayMs = 0;
  let lastStartedFlashAt: number | null = null;
  let lastFlashedForMessageId: string | null = null;

  const removeHighlight = () => {
    highlightAnimation = "none";
    highlightDelayMs = 0;
    if (flashClassRemoveTimeout) {
      clearTimeout(flashClassRemoveTimeout);
      flashClassRemoveTimeout = null;
    }
  };

  $: flashHighlightDetails = $highlightedTopicStore.get(expandKey);
  $: flashHighlightDetails,
    (async () => {
      const now = new Date().getTime();
      const shouldChangeCauseFlash =
        flashHighlightDetails?.highlightCause === "message-update" ||
        (flashHighlightDetails?.highlightCause === "child-update" &&
          !isExpanded);
      const isChangeRecent =
        flashHighlightDetails?.highlightAt !== undefined &&
        now - flashHighlightDetails?.highlightAt < FLASH_DURATION_MS;
      if (shouldChangeCauseFlash && isChangeRecent && flashHighlightDetails) {
        // const hasFlashedRecently =
        //   lastStartedFlashAt !== null &&
        //   flashHighlightDetails.highlightAt - lastStartedFlashAt <
        //     FLASH_DURATION_MS;
        const flashedLastForThisMessage =
          lastFlashedForMessageId ===
          flashHighlightDetails.highlightFromMessageId;
        if (flashedLastForThisMessage) {
          return;
        }
        removeHighlight();
        await tick();
        lastStartedFlashAt = now;
        lastFlashedForMessageId = flashHighlightDetails.highlightFromMessageId;
        highlightAnimation = `flash-background ${FLASH_DURATION_MS}ms 1`;
        // negative value to start animation partway through if row has moved
        highlightDelayMs = 0 - (now - flashHighlightDetails?.highlightAt);
        flashClassRemoveTimeout = setTimeout(() => {
          removeHighlight();
        }, FLASH_DURATION_MS);
      } else {
        removeHighlight();
      }
    })();

  onDestroy(() => {
    removeHighlight();
  });
</script>

<div
  class={twMerge(
    "flex whitespace-nowrap cursor-pointer select-none",
    "overflow-hidden min-w-0 w-full"
  )}
>
  <button
    on:click={() => {
      toggleExpansion(expandKey);
    }}
  >
    <div class={`w-4 relative`}>
      {#if subtopicCount > 0}
        <div class={`${isExpanded ? "rotate-90" : "rotate-0"}`}>
          <Button variant="text" iconType="right" iconSize={14} />
        </div>
      {/if}
    </div>
  </button>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    id={`topic-row-${expandKey}`}
    class={twMerge(
      "text-secondary-text font-thin font-mono ring-inset px-1",
      "flex w-fit min-w-0",
      "rounded truncate overflow-hidden",
      isSelected ? "ring-1 ring-primary" : "",
      "hover:ring-1 hover:ring-secondary-text"
    )}
    style:animation-delay={`${highlightDelayMs}ms`}
    style:animation={highlightAnimation ?? undefined}
    on:click={onTopicSelect}
    on:keypress={onTopicSelect}
  >
    <p class="font-semibold text-white/90 mr-2">{topicLevel}</p>
    {#if subtopicCount > 0}
      <div class="w-3 min-w-3 ml-[2px] relative">
        <div class="absolute top-[4px] left-0">
          <Icon type="subItem" size={10} />
        </div>
      </div>
      <div class="">
        <span>
          {subtopicCount}
        </span>
      </div>
      <div class="ml-2">|</div>{/if}
    {#if messageCount > 0}
      <div
        class={`${subtopicCount > 0 ? "ml-2" : "ml-1"} mr-1 flex items-center gap-1`}
      >
        <span class="inline-block pb-[2px]">
          <Icon type="message" size={14} />
        </span>
        <span>{messageCount}</span>
      </div>
    {/if}
    {#if isDecodedProto}
      <span class="inline-block ml-2 mt-[1px]">
        <ProtobufLogo class="size-4" isActive />
      </span>
    {/if}
    {#if message !== undefined}
      <!-- <div class="grow bg-green-800"></div> -->
      <p class="ml-2 min-w-0 truncate font-normal grow text-white/90">
        {@html syntaxHighlightedMessage}
      </p>
    {/if}
  </div>
</div>
