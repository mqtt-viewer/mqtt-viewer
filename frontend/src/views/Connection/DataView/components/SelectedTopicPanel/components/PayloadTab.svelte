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
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import FieldPicker from "./Chart/FieldPicker.svelte";
  import { payloadTree, hasNumericFields } from "./Chart/payload-fields";
  import type { ChartSeriesStore } from "./Chart/chart-series-store";
  import {
    detectImage,
    imageDataUrl,
    base64ByteSize,
    formatByteSize,
  } from "./image-payload";

  export let isComparing: boolean;
  export let payload: string;
  export let payloadLeftForCompare: string | null = null;
  // True while the previous message's payload is still being fetched
  // (ensurePayload in flight): distinguishes "loading" from "genuinely no
  // previous message" (both otherwise look like payloadLeftForCompare===null).
  export let payloadLeftLoading = false;
  // True when the previous message existed but its payload aged out of the
  // backend's retention window before it could be fetched.
  export let payloadLeftAgedOut = false;
  // Where the current history came from; drives the aged-out explanation
  // (session memory vs recorded disk history).
  export let historySource: "memory" | "disk" = "memory";
  // Whether durable recording is enabled, for the aged-out copy in memory
  // mode.
  export let recordingEnabled = false;
  // Optional: lets the aged-out state offer switching to recorded history.
  export let onLoadRecordedHistory: (() => void) | null = null;
  // Raw base64 payload; when its bytes are an image, a preview is rendered.
  export let payloadB64: string | null = null;
  export let codec: SupportedCodeEditorCodec;
  export let format: SupportedCodeEditorFormat;
  // Optional: when present, a "Chart fields" toggle reveals the numeric picker.
  export let chartSeriesStore: ChartSeriesStore | null = null;
  export let onViewChart: (() => void) | null = null;
  // Bindable so the Chart tab's "Add value from payload" can open the picker.
  export let showFieldPicker = false;

  let showRawImageBytes = false;
  // Reset the raw-bytes escape hatch when switching messages.
  $: payloadB64, (showRawImageBytes = false);

  $: detectedImage = isComparing ? null : detectImage(payloadB64);
  $: showImagePreview = detectedImage !== null && !showRawImageBytes;

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
    {#if detectedImage && showRawImageBytes}
      <Tooltip text="Show image preview">
        <button
          class="flex items-center gap-1 text-sm px-2 py-1 rounded whitespace-nowrap text-secondary-text hover:text-emphasis"
          on:click={() => (showRawImageBytes = false)}
        >
          <Icon type="image" size={14} />
          Preview
        </button>
      </Tooltip>
    {/if}
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

  {#if showImagePreview && detectedImage && payloadB64}
    <div class="grow w-full min-h-0 flex flex-col">
      <div class="grow min-h-0 flex items-center justify-center overflow-auto p-2">
        <img
          src={imageDataUrl(payloadB64, detectedImage.mime)}
          alt="{detectedImage.label} payload"
          class="max-w-full max-h-full object-contain"
        />
      </div>
      <div
        class="flex items-center justify-between px-2 py-1 border-t border-divider text-sm text-secondary-text"
      >
        <span>{detectedImage.label} · {formatByteSize(base64ByteSize(payloadB64))}</span>
        <button
          class="text-primary"
          on:click={() => (showRawImageBytes = true)}>View raw bytes</button
        >
      </div>
    </div>
  {:else if showFieldPicker && tree}
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
          <div
            class="w-1/2 flex flex-col items-center gap-2 pt-4 px-2 text-center text-secondary-text"
          >
            {#if payloadLeftLoading}
              Loading message...
            {:else if payloadLeftAgedOut}
              {#if historySource === "disk"}
                <span>
                  No longer on disk. Recorded history prunes the oldest
                  messages to stay within its storage budget.
                </span>
              {:else if recordingEnabled}
                <span>No longer in session memory.</span>
                {#if onLoadRecordedHistory}
                  <Button variant="text" on:click={onLoadRecordedHistory}
                    >Load recorded history</Button
                  >
                {/if}
              {:else}
                <span>
                  No longer in session memory. Enable recording in settings to
                  keep messages across restarts.
                </span>
              {/if}
            {:else}
              No message
            {/if}
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
