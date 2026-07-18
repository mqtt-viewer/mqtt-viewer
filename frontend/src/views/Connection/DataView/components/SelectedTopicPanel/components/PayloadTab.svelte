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
  import {
    detectImage,
    imageDataUrl,
    base64ByteSize,
    formatByteSize,
  } from "./image-payload";
  import SparkplugLogo from "@/components/SparkplugLogo/SparkplugLogo.svelte";
  import Button from "@/components/Button/Button.svelte";
  import { formatClockTime } from "../../MqttDataPanel/components/SparkplugPanel/build-sparkplug-tree";
  import { PublishSparkplugRebirth } from "bindings/mqtt-viewer/backend/app/app";

  /** The message's middlewareProperties["sparkplug"] meta, when present. */
  export let sparkplugMeta: {
    msgType: string;
    group?: string;
    edgeNode?: string;
    device?: string;
    hostId?: string;
    resolution?: string;
    birthAtMs?: number;
    bdSeq?: number;
  } | null = null;
  /** Needed for the unresolved banner's Request rebirth action. */
  export let connectionId: number | null = null;

  export let isComparing: boolean;
  export let payload: string;
  export let payloadLeftForCompare: string | null = null;
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

  // --- Sparkplug banner --------------------------------------------------------
  $: spIsData =
    sparkplugMeta?.msgType === "NDATA" || sparkplugMeta?.msgType === "DDATA";
  $: spUnresolved = spIsData && sparkplugMeta?.resolution === "unresolved";
  $: spPartial = spIsData && sparkplugMeta?.resolution === "partial";
  $: spResolvedFrom =
    spIsData &&
    (sparkplugMeta?.resolution === "resolved" || spPartial) &&
    sparkplugMeta?.birthAtMs !== undefined
      ? formatClockTime(sparkplugMeta!.birthAtMs!)
      : null;

  let rebirthInFlight = false;
  const requestRebirth = async () => {
    if (!sparkplugMeta || connectionId === null) return;
    rebirthInFlight = true;
    try {
      await PublishSparkplugRebirth(
        connectionId,
        sparkplugMeta.group ?? "",
        sparkplugMeta.edgeNode ?? ""
      );
    } catch (e) {
      console.error("sparkplug: rebirth request failed", e);
    } finally {
      rebirthInFlight = false;
    }
  };
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

  {#if sparkplugMeta}
    <div
      class="text-sm border-b border-divider py-1 px-2 flex items-center gap-2 text-secondary-text whitespace-nowrap overflow-hidden"
    >
      <SparkplugLogo class="size-4 shrink-0" isActive />
      {#if sparkplugMeta.msgType === "STATE"}
        <span class="truncate"
          >Sparkplug host state - {sparkplugMeta.hostId}</span
        >
      {:else if spUnresolved}
        <span class="text-warning truncate"
          >aliases unresolved - no birth seen</span
        >
        <Button
          variant="text"
          class="text-sm"
          disabled={rebirthInFlight || connectionId === null}
          on:click={requestRebirth}>Request rebirth</Button
        >
      {:else if spIsData && spResolvedFrom}
        <span class="truncate"
          >Sparkplug B {sparkplugMeta.msgType} - aliases resolved from birth
          {spResolvedFrom}</span
        >
        {#if spPartial}
          <span class="text-warning">some aliases unresolved</span>
        {/if}
      {:else}
        <span class="truncate">Sparkplug B {sparkplugMeta.msgType}</span>
        {#if sparkplugMeta.bdSeq !== undefined}
          <span>bdSeq {sparkplugMeta.bdSeq}</span>
        {/if}
      {/if}
    </div>
  {/if}

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
