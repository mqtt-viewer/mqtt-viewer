<script lang="ts">
  import StatsStore, { StatsMode } from "@/stores/stats";
  import TabsStore from "@/stores/tabs";
  import Button from "@/components/Button/Button.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";

  $: totalMessagesPerSec = $StatsStore.diffFrom1sAgo.totalMessagesReceived;

  $: mqttStatsForCurrentTab = !isNaN(Number($TabsStore.selectedTab))
    ? $StatsStore.diffFrom1sAgo.statsByConnection[
        $TabsStore.selectedTab as number
      ]
    : null;
  $: currentMessagesPerSec = !!mqttStatsForCurrentTab
    ? mqttStatsForCurrentTab.messagesReceived
    : 0;
</script>

<Tooltip placement="top">
  <Button variant="text" on:click={() => StatsStore.toggleMode()}>
    {#if $StatsStore.mode === StatsMode.ConnPerSec}
      {currentMessagesPerSec} message{currentMessagesPerSec !== 1 ? "s" : ""}/s
    {:else if $StatsStore.mode === StatsMode.TotalPerSec}
      {totalMessagesPerSec} message{totalMessagesPerSec !== 1 ? "s" : ""}/s
      total
    {/if}
  </Button>
  <span slot="tooltip-content">
    {#if $StatsStore.mode === StatsMode.ConnPerSec}
      Showing data for the selected connection
    {:else}
      Showing data for all connections combined
    {/if}
  </span>
</Tooltip>
