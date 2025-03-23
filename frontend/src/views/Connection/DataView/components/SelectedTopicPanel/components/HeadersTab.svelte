<script lang="ts">
  import type { mqtt } from "wailsjs/go/models";
  import HeaderRow from "./shared/HeaderRow.svelte";
  import { getSortedObjectDiffs } from "./shared/diff-helpers";

  export let isComparing: boolean;
  export let headers: mqtt.MessageProperties;
  export let headersToCompare = undefined as mqtt.MessageProperties | undefined;

  console.log("headers", headers);
  const headersList: {
    key: keyof mqtt.MessageProperties;
    humanReadable: string;
  }[] = [
    {
      key: "contentType",
      humanReadable: "Content Type",
    },
    {
      key: "payloadFormat",
      humanReadable: "Payload Format Indicator",
    },
    {
      key: "messageExpiry",
      humanReadable: "Message Expiry Interval",
    },
    {
      key: "responseTopic",
      humanReadable: "Response Topic",
    },
    {
      key: "correlationData",
      humanReadable: "Correlation Data",
    },
  ];

  const getKeyValuePair = (key: string, value?: string) => {
    // Correlation data comes through as an encoded string
    if (key === "correlationData") {
      const decodedValue = value ? atob(value) : "";
      return [key, decodedValue];
    }
    if (key === "payloadFormat") {
      return [key, !!value ? "On" : "Off"];
    }
    if (!value) {
      return [key, ""];
    }
    return [key, `${value}`];
  };

  $: headersAsObject = Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => {
      return getKeyValuePair(key, value);
    })
  );

  $: headersToCompareAsObject = Object.fromEntries(
    Object.entries(headersToCompare ?? {}).map(([key, value]) => {
      return getKeyValuePair(key, value);
    })
  );

  $: diffedHeaders = getSortedObjectDiffs({
    objectLeft: headersToCompareAsObject,
    objectRight: headersAsObject ?? {},
  });
</script>

<div class="flex flex-col gap-3 max-h-full overflow-auto">
  {#if isComparing}
    <div class="flex">
      <div class="w-1/3 max-w-1/3">Header</div>
      <div class="w-1/3 max-w-1/3">Previous</div>
      <div class="w-1/3 max-w-1/3">Current</div>
    </div>
    {#each headersList as headerItem}
      <HeaderRow
        rowName={headerItem.humanReadable}
        rowValue={diffedHeaders[headerItem.key]?.valueRight ?? ""}
        rowValueDiff={diffedHeaders[headerItem.key]?.valueRightDiff}
        rowValueToCompare={diffedHeaders[headerItem.key]?.valueLeft ?? ""}
        rowValueToCompareDiff={diffedHeaders[headerItem.key]?.valueLeftDiff}
      />
    {/each}
  {:else}
    <div class="flex">
      <div class="w-1/2 max-w-1/2">Header</div>
      <div class="w-1/2 max-w-1/2">Value</div>
    </div>
    {#each headersList as headerItem}
      <HeaderRow
        rowName={headerItem.humanReadable}
        rowValue={diffedHeaders[headerItem.key]?.valueRight ?? ""}
      />
    {/each}
  {/if}
</div>
