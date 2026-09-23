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
  import SparkplugLogo from "@/components/SparkplugLogo/SparkplugLogo.svelte";
  import { formatClockTime } from "../../MqttDataPanel/components/SparkplugPanel/build-sparkplug-tree";

  /** The message's middlewareProperties["sparkplug"] meta, when present. */
  export let sparkplugMeta: {
    msgType: string;
    group?: string;
    edgeNode?: string;
    device?: string;
    hostId?: string;
    resolution?: string;
    birthAtMs?: number;
    carriedOver?: boolean;
    seqGap?: { expected: number; got: number };
    bdSeq?: number;
  } | null = null;
  /**
   * Asks for a rebirth of the message's edge node. The caller confirms
   * before anything is published. Absent where no rebirth can be offered.
   */
  export let onRequestRebirth:
    | ((targets: { group: string; node: string }[]) => void)
    | null = null;

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

  // --- Sparkplug banner --------------------------------------------------------
  // One line above the payload that says where the names in it came from, so
  // an injected name is never mistaken for one that was on the wire.
  $: spIsData =
    sparkplugMeta?.msgType === "NDATA" || sparkplugMeta?.msgType === "DDATA";
  $: spResolution = spIsData ? sparkplugMeta?.resolution : undefined;
  $: spBirthTime =
    sparkplugMeta?.birthAtMs !== undefined
      ? formatClockTime(sparkplugMeta.birthAtMs)
      : null;
  $: spTone =
    spResolution === "unresolved" ||
    spResolution === "partial" ||
    sparkplugMeta?.carriedOver
      ? "warning"
      : "normal";
  $: spLabel = (() => {
    const m = sparkplugMeta;
    if (!m) return "";
    const type = `Sparkplug B ${m.msgType}`;
    if (m.msgType === "STATE") return `Sparkplug host state for ${m.hostId}`;
    if (!spIsData) {
      return m.bdSeq !== undefined ? `${type}, bdSeq ${m.bdSeq}` : type;
    }
    switch (spResolution) {
      case "names":
        return `${type}, names as published`;
      case "unresolved":
        return `${type}: aliases only, no birth seen since connecting`;
      case "partial":
        return `${type}: some aliases unresolved, others named from the birth at ${spBirthTime}`;
      default:
        return m.carriedOver
          ? `${type}: names from the birth at ${spBirthTime}, before the connection dropped`
          : `${type}: names from the birth at ${spBirthTime}`;
    }
  })();
  $: spOffersRebirth =
    onRequestRebirth !== null &&
    spIsData &&
    (spResolution === "unresolved" ||
      spResolution === "partial" ||
      !!sparkplugMeta?.carriedOver);
  $: spTooltip = (() => {
    if (spResolution === "unresolved" || spResolution === "partial") {
      return "Sparkplug data messages carry aliases, and the names are only sent in the node's birth. A rebirth sends them again.";
    }
    if (sparkplugMeta?.carriedOver) {
      return "The connection dropped after this birth. If the node rebirthed while disconnected, its aliases may have changed.";
    }
    if (spIsData && spResolution !== "names") {
      return "Names were filled in from the birth, not sent in this message.";
    }
    return spLabel;
  })();

  const requestRebirth = () => {
    if (!sparkplugMeta || !onRequestRebirth) return;
    onRequestRebirth([
      { group: sparkplugMeta.group ?? "", node: sparkplugMeta.edgeNode ?? "" },
    ]);
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
      <Tooltip text="Show image preview" focusable>
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
      <Tooltip text={showFieldPicker ? "Show raw payload" : "Pick values to chart"} focusable>
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
      <Tooltip
        class={spTone === "warning" ? "text-warning truncate" : "truncate"}
        text={spTooltip}>{spLabel}</Tooltip
      >
      {#if sparkplugMeta.seqGap}
        <span
          class="text-warning shrink-0"
          title={`Expected seq ${sparkplugMeta.seqGap.expected}, got ${sparkplugMeta.seqGap.got}`}
          >seq gap</span
        >
      {/if}
      {#if spOffersRebirth}
        <div class="grow"></div>
        <Button variant="text" class="text-sm shrink-0" on:click={requestRebirth}
          >Request rebirth</Button
        >
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
