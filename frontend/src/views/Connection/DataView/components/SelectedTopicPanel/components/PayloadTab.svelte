<script lang="ts">
  import CodeEditor from "@/components/CodeEditor/CodeEditor.svelte";
  import CodeEditorConfigBar from "@/components/CodeEditor/CodeEditorConfigBar.svelte";
  import DiffCodeEditor from "@/components/CodeEditor/DiffCodeEditor.svelte";
  import {
    decodePayload,
    type SupportCodeEditorCodec,
  } from "@/components/CodeEditor/codec";
  import {
    formatPayload,
    type SupportedCodeEditorFormat,
  } from "@/components/CodeEditor/formatting";

  export let isComparing: boolean;
  export let payload: string;
  export let payloadLeftForCompare: string | null = null;
  export let codec: SupportCodeEditorCodec;
  export let format: SupportedCodeEditorFormat;

  $: processPayload = (payload: string) => {
    let p = payload;
    if (codec !== "none") {
      try {
        const decoded = decodePayload(p, codec);
        p = decoded;
      } catch (e) {
        console.error("error decoding payload", e);
      }
    }
    if (format === "json-prettier") {
      p = formatPayload(p, "json-prettier");
    }
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
</script>

<div
  class="size-full max-h-full min-h-0 max-w-full flex flex-col overflow-hidden
        border border-outline rounded-sm p-[1px]"
>
  <CodeEditorConfigBar
    bind:codec
    bind:format
    isReadyOnly
    {isComparing}
    textToCopy={processedPayload}
    textToCopyOnLeft={processedPayloadLeft}
  />
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
</div>
