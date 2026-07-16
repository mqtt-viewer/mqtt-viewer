<script lang="ts">
  import { onMount } from "svelte";
  import connections from "@/stores/connections";
  import AppBar from "@/components/AppBar/AppBar.svelte";
  import { gsap } from "gsap";
  import { Flip } from "gsap/Flip";
  import { Draggable } from "gsap/Draggable";
  import IconContext from "@/components/Icon/IconContext.svelte";
  import initialization from "@/stores/initialization";
  import Home from "@/views/Home/Home.svelte";
  import Connection from "@/views/Connection/Connection.svelte";
  import tabs from "@/stores/tabs";
  import NewTab from "@/views/NewTab/NewTab.svelte";
  import Toast from "@/components/Toast/Toast.svelte";
  import { oneDarkHighlightStyle } from "@/components/CodeEditor/theme";
  import panelSizes from "./stores/panel-sizes";
  import MaxOpenTabsDialog from "./components/MaxOpenTabsDialog/MaxOpenTabsDialog.svelte";
  import AppBarBottom from "./components/AppBarBottom/AppBarBottom.svelte";
  import PleaseUpdate from "./views/PleaseUpdate/PleaseUpdate.svelte";
  import UpdateDialog from "./components/UpdateDialog/UpdateDialog.svelte";
  import ChartWindow from "./views/ChartWindow/ChartWindow.svelte";
  import BrokerStatusWindow from "./views/BrokerStatusWindow/BrokerStatusWindow.svelte";
  import HistoryRetentionPrompt from "./components/HistoryRetentionPrompt/HistoryRetentionPrompt.svelte";
  import WhatsNewDialog from "./components/WhatsNewDialog/WhatsNewDialog.svelte";
  import StarPromptDialog from "./components/StarPromptDialog/StarPromptDialog.svelte";

  // Detached chart windows (opened by OpenChartWindow) load the same assets at
  // /?view=chart&...; render only the standalone chart, not the full app shell.
  const isChartWindow =
    new URLSearchParams(window.location.search).get("view") === "chart";
  // Detached broker-status windows (opened by OpenBrokerStatusWindow) load the
  // same assets at /?view=status&conn=<id>; render only the standalone window.
  const isStatusWindow =
    new URLSearchParams(window.location.search).get("view") === "status";

  gsap.registerPlugin(Flip);
  gsap.registerPlugin(Draggable);

  $: connectionIds = Object.keys($connections.connections)?.map(
    (c) => $connections.connections[parseInt(c)].connectionDetails.id
  );
  $: isNewTabSelected = $tabs.isNewTabSelected;
  $: isHomeSelected = !isNewTabSelected && $tabs.selectedTab === "home";

  onMount(() => {
    // These styles are mounted for syntax highlighting in DataView
    const highlightStyles = oneDarkHighlightStyle.module?.getRules();
    document.head.insertAdjacentHTML(
      "beforeend",
      // svelte-preprocessor doesn't like finding properly formed
      // <style> tags where they shouldn't be, hence the break-up
      `<` + `style>${highlightStyles}</>`
    );
  });

  let appWidth: number;
  $: appWidth,
    (() => {
      if (!!appWidth) {
        panelSizes.updateAppWidth(appWidth);
      }
    })();

  // Temporary, used to force an update if necessary
  $: pleaseUpdate = false;
</script>

{#if isChartWindow}
  <ChartWindow />
{:else if isStatusWindow}
  <BrokerStatusWindow />
{:else}
  <main
    class="h-full w-full flex flex-col bg-elevation-0"
    bind:clientWidth={appWidth}
  >
  <IconContext>
    {#await initialization.init()}
      <span>Loading....</span>
    {:then _}
      {#if pleaseUpdate}
        <div class="absolute top-0 left-0 size-full z-[5000] bg-elevation-0">
          <PleaseUpdate />
        </div>
      {/if}

      <AppBar />
      <div class="w-full flex-grow min-h-0">
        {#if isNewTabSelected}
          <NewTab />
        {:else if isHomeSelected}
          <Home />
        {/if}
        {#each connectionIds as connectionId}
          <Connection {connectionId} />
        {/each}
      </div>
      <AppBarBottom />
      <MaxOpenTabsDialog />
      <UpdateDialog />
      <HistoryRetentionPrompt />
      <WhatsNewDialog />
      <StarPromptDialog />
    {/await}
    <Toast />
  </IconContext>
  </main>
{/if}
