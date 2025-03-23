<script lang="ts">
  import os from "@/stores/env";
  import tabs from "@/stores/tabs";
  import Icon from "@/components/Icon/Icon.svelte";
  import { twMerge } from "tailwind-merge";
  import ConnectionTabs from "./components/ConnectionTabs/ConnectionTabs.svelte";
  import NewTabButton from "./components/NewTabButton.svelte";
  import { MAX_OPEN_TABS } from "@/stores/tabs";
  import IconButton from "../Button/IconButton.svelte";
  import { writable } from "svelte/store";
  import NotificationsButton from "./components/NotificationsButton.svelte";
  import FeedbackDialog from "./components/FeedbackDialog/FeedbackDialog.svelte";

  let className = "";
  export { className as class };

  let tabContainerWidth = 0;
  let newTabButtonWidth = 0;
  $: maxTabContainerWidth =
    countOpenTabs < MAX_OPEN_TABS
      ? tabContainerWidth - newTabButtonWidth
      : tabContainerWidth;
  $: isNewTabSelected = $tabs.isNewTabSelected;
  $: isHomeSelected = !$tabs.isNewTabSelected && $tabs.selectedTab === "home";
  $: countOpenTabs = $tabs.tabs.length;

  let feedbackDialogOpen = writable(false);
</script>

<div
  class={twMerge("w-full h-[38px] min-h-[38px] bg-black flex", className)}
  style="--wails-draggable:drag"
>
  {#if $os.isMac && !$os.isFullscreen}
    <!-- Make space for MAC OS window controls -->
    <div class="min-w-[78px]" />
  {/if}
  <button
    class={twMerge(
      "min-w-[38px] flex items-center justify-center opacity-70 border-r-[1px] border-outline",
      "hover:opacity-100",
      isHomeSelected && "bg-elevation-1 opacity-100"
    )}
    on:click={() => tabs.selectTab("home")}
  >
    <Icon type="home" selected={isHomeSelected} />
  </button>
  <div class="flex-grow flex min-w-0" bind:clientWidth={tabContainerWidth}>
    <ConnectionTabs maxContainerWidth={maxTabContainerWidth} />
    {#if countOpenTabs < MAX_OPEN_TABS}
      <NewTabButton
        bind:newTabButtonWidth
        isSelected={isNewTabSelected}
        onClick={() =>
          isNewTabSelected ? tabs.deselectNewTab() : tabs.selectNewTab()}
      />
    {/if}
  </div>
  <div
    class={"mr-4 flex items-center gap-1 relative z-10"}
    style="--wails-draggable:false"
  >
    <NotificationsButton />
    <IconButton
      onClick={() => {
        feedbackDialogOpen.set(true);
      }}><div class="px-1">Feedback</div></IconButton
    >
  </div>
</div>
<FeedbackDialog open={feedbackDialogOpen} />
