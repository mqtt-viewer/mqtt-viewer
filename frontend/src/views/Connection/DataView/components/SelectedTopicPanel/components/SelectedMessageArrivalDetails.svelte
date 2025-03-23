<script lang="ts">
  import moment from "moment";
  import { twMerge } from "tailwind-merge";

  export let isComparing: boolean;
  export let selectedArrivedAtMs: number;
  export let selectedRetain: boolean;

  export let previousArrivedAtMs: number | null;
  export let previousRetain: boolean;

  let className = "";
  export { className as class };

  const getArrivedAtString = (arrivedAtMs: number | null) => {
    if (!arrivedAtMs) return "";
    return `Arrived: ${moment(arrivedAtMs).format("H:mm:ss.SS")}`;
  };

  $: selectedArrivedAtString = getArrivedAtString(selectedArrivedAtMs);
  $: previousArrivedAtString = getArrivedAtString(previousArrivedAtMs);
</script>

<div
  class={twMerge("w-full flex justify-between  text-secondary-text", className)}
>
  <div class="flex flex-col">
    {#if isComparing}
      <div>Previous:</div>
      <div>{previousArrivedAtString}</div>
      {#if previousRetain}
        <div class="text-secondary">Retained</div>
      {/if}
    {/if}
  </div>
  <div class="flex flex-col">
    {#if isComparing}
      <div>Selected:</div>
    {/if}
    <div>{selectedArrivedAtString}</div>
    {#if selectedRetain}
      <div class="text-secondary">Retained</div>
    {/if}
  </div>
</div>

<!-- 
<div
  class={twMerge("w-full flex justify-between text-secondary-text", className)}
>
  {#if !isComparing}
    <div class="text-secondary">{selectedRetain ? "Retained" : ""}</div>
    <div>Arrived {selectedArrivedAtString}</div>
  {:else}
    <div class="flex flex-col gap-[2px] text-left">
      {#if previousArrivedAtString !== null}
        <div>{previousArrivedAtString}</div>
      {/if}
      {#if previousRetain}
        <div class="text-secondary">Retained</div>
      {/if}
    </div>
    <div class="flex flex-col gap-1 text-right">
      <div>{selectedArrivedAtString}</div>
      {#if selectedRetain}
        <div class="text-secondary">Retained</div>
      {/if}
    </div>
  {/if}
</div> -->
