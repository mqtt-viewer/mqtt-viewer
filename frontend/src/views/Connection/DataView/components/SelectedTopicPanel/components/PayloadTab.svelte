<script lang="ts">
  import CodeEditor from "@/components/CodeEditor/CodeEditor.svelte";
  import CodeEditorConfigBar from "@/components/CodeEditor/CodeEditorConfigBar.svelte";
  import DiffCodeEditor from "@/components/CodeEditor/DiffCodeEditor.svelte";
  import {
    decodePayload,
    type SupportedCodeEditorCodec,
  } from "@/components/CodeEditor/codec";
  import {
    formatPayload,
    type SupportedCodeEditorFormat,
  } from "@/components/CodeEditor/formatting";
  import Icon from "@/components/Icon/Icon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import FieldPicker from "./Chart/FieldPicker.svelte";
  import { payloadTree, hasNumericFields } from "./Chart/payload-fields";
  import type { ChartSeriesStore } from "./Chart/chart-series-store";

  export let isComparing: boolean;
  export let payload: string;
  export let payloadLeftForCompare: string | null = null;
  export let codec: SupportedCodeEditorCodec;
  export let format: SupportedCodeEditorFormat;
  // Optional: when present, a "Chart fields" toggle reveals the numeric picker.
  export let chartSeriesStore: ChartSeriesStore | null = null;
  export let onViewChart: (() => void) | null = null;

  let showFieldPicker = false;

  $: processPayload = (payload: string) => {
    let p = payload;
    if (codec !== "none") {
      try {
        p = decodePayload(p, codec);
      } catch (e) {
        console.error("error decoding payload", e);
      }
    }
    p = formatPayload(p, format);
    return p;
  };

  let processedPayload = payload;
  let processedPayloadLeft = payloadLeftForCompare;
  $: payload,
    payloadLeftForCompare,
    codec,
    format,
    (() => {
      processedPayload = processPayload(payload);
      if (isComparing && payloadLeftForCompare) {
        processedPayloadLeft = processPayload(payloadLeftForCompare);
      }
    })();

  $: canChart =
    chartSeriesStore !== null &&
    !isComparing &&
    hasNumericFields(processedPayload);
  // Drop back to raw view if the current payload has nothing to chart.
  $: if (!canChart && showFieldPicker) showFieldPicker = false;

  $: tree = showFieldPicker ? payloadTree(processedPayload) : null;
  $: selectedColors = new Map(
    ($chartSeriesStore ?? []).map((s) => [s.path, s.color])
  );
  $: selectedCount = ($chartSeriesStore ?? []).length;
</script>

<div
  class="size-full max-h-full min-h-0 max-w-full flex flex-col overflow-hidden
        border border-outline rounded-sm p-[1px]"
>
  <div class="flex items-center w-full">
    <div class="grow min-w-0">
      <CodeEditorConfigBar
        bind:codec
        bind:format
        isReadyOnly
        {isComparing}
        textToCopy={processedPayload}
        textToCopyOnLeft={processedPayloadLeft}
      />
    </div>
    {#if canChart}
      <Tooltip text={showFieldPicker ? "Show raw payload" : "Pick values to chart"}>
        <button
          class={`flex items-center gap-1 text-sm px-2 py-1 rounded whitespace-nowrap ${
            showFieldPicker ? "text-primary" : "text-secondary-text hover:text-emphasis"
          }`}
          on:click={() => (showFieldPicker = !showFieldPicker)}
        >
          <Icon type="chart" size={14} />
          Chart fields
        </button>
      </Tooltip>
    {/if}
  </div>

  {#if showFieldPicker && tree}
    <div class="grow w-full min-h-0 overflow-auto px-1 py-1">
      <FieldPicker
        node={tree}
        selected={selectedColors}
        onToggle={(path) => chartSeriesStore?.toggleField(path)}
      />
    </div>
    <div
      class="flex items-center justify-between px-2 py-1 border-t border-divider text-sm"
    >
      <span class="text-secondary-text"
        >{selectedCount} value{selectedCount === 1 ? "" : "s"} selected</span
      >
      {#if onViewChart}
        <button class="text-primary" on:click={onViewChart}>View chart →</button>
      {/if}
    </div>
  {:else}
    <div class="grow w-full min-h-0">
      {#if !isComparing}
        <CodeEditor text={processedPayload} {format} readOnly />
      {:else if payloadLeftForCompare == null}
        <div class="w-full flex">
          <div class="w-1/2 flex justify-center pt-4 text-secondary-text">
            No message
          </div>
          <div class="w-1/2">
            <CodeEditor text={processedPayload} {format} readOnly />
          </div>
        </div>
      {:else}
        <DiffCodeEditor
          left={processedPayloadLeft ?? ""}
          right={processedPayload}
        />
      {/if}
    </div>
  {/if}
</div>
