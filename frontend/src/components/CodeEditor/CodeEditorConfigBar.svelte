<script lang="ts">
  import IconButton from "../Button/IconButton.svelte";
  import CopyToClipboard from "../CopyToClipboard/CopyToClipboard.svelte";
  import type { SupportCodeEditorCodec } from "./codec";
  import CodeEditorConfigBarOption from "./CodeEditorConfigBarOption.svelte";
  import type { SupportedCodeEditorFormat } from "./formatting";

  export let isReadyOnly: boolean = false;
  export let isComparing: boolean = false;
  export let codec: SupportCodeEditorCodec = "none";
  export let format: SupportedCodeEditorFormat = "none";
  export let textToCopy: string;
  export let textToCopyOnLeft: string | null = null;
  export let formatPayload: () => void = () => {};

  let setCodec: (value: string | undefined) => void;
  let setFormat: (value: string | undefined) => void;

  $: codec,
    (() => {
      if (setCodec === undefined) return;
      setCodec(codec);
    })();

  $: format,
    (() => {
      if (setFormat === undefined) return;
      setFormat(format);
    })();
</script>

<div class="w-full flex items-center relative">
  <CodeEditorConfigBarOption
    name="codec"
    bind:setValue={setCodec}
    options={["none", "base64", "hex"]}
    defaultValue={codec}
    onChange={(value) => {
      if (value !== undefined) {
        //@ts-ignore
        codec = value;
      }
    }}
    getOptionDisplay={(option) => {
      switch (option) {
        case "none":
          if (isReadyOnly) {
            return "Decode";
          }
          return "Encode";
        case "base64":
          return "Base64";
        case "hex":
          return "Hex";
        default:
          return "";
      }
    }}
    getOptionLabel={(option) => {
      switch (option) {
        case "none":
          if (isReadyOnly) {
            return "No decoding";
          }
          return "No encoding";
        case "base64":
          return "Base64";
        case "hex":
          return "Hex";
        default:
          return "";
      }
    }}
  />
  <CodeEditorConfigBarOption
    name="format"
    bind:setValue={setFormat}
    options={isReadyOnly ? ["none", "json", "json-prettier"] : ["none", "json"]}
    defaultValue={format}
    onChange={(value) => {
      if (value !== undefined) {
        //@ts-ignore
        format = value;
      }
    }}
    getOptionDisplay={(option) => {
      switch (option) {
        case "none":
          return "Format";
        case "json":
          return "JSON";
        case "json-prettier":
          return "JSONp";
        default:
          return "";
      }
    }}
    getOptionLabel={(option) => {
      switch (option) {
        case "none":
          return "No formatting";
        case "json":
          return "JSON";
        case "json-prettier":
          return "JSON Pretty";
        default:
          return "";
      }
    }}
  />
  {#if !isReadyOnly && format === "json"}
    <IconButton onClick={formatPayload}>Prettify</IconButton>
  {/if}
  {#if isComparing}
    <CopyToClipboard
      class="absolute top-0 left-1/2 "
      text={textToCopyOnLeft ?? ""}
      tooltipText={"Copy previous payload"}
      size={16}
    />
  {/if}
  <div class="grow"></div>
  <CopyToClipboard
    class=""
    text={textToCopy ?? ""}
    tooltipText={"Copy selected payload"}
    size={16}
  />
</div>
