<script lang="ts">
  import MessageTimeline from "./components/MessageTimeline.svelte";
  import PanelHeader from "@/components/PanelHeader/PanelHeader.svelte";
  import Tabs from "@/components/Tabs/Tabs.svelte";
  import PayloadTab from "./components/PayloadTab.svelte";
  import HeadersTab from "./components/HeadersTab.svelte";
  import UserPropertiesTab from "./components/UserPropertiesTab.svelte";
  import type {
    MqttHistoryMessage,
    SelectedTopicStore,
  } from "../../stores/selected-topic-store";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import SelectedMessageArrivalDetails from "./components/SelectedMessageArrivalDetails.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import DropdownCloseOnClick from "@/components/DropdownMenu/DropdownCloseOnClick.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Topic from "./components/Topic.svelte";

  export let connectionId: number;
  export let selectedTopicStore: SelectedTopicStore;
  export let firstConnectedAtMs: number;
  export let mqttVersion: "3" | "5";
  export let deleteRetainedMessage: (topic: string) => Promise<void>;

  $: selectedTopicString = $selectedTopicStore.selectedTopic;

  let selectedMessageId: string | null = null;
  $: selectedMessageIndex = $selectedTopicStore.history.findIndex(
    (message) => message.id === selectedMessageId
  );
  $: selectedMessage =
    selectedMessageIndex !== -1
      ? ($selectedTopicStore.history[
          selectedMessageIndex
        ] as MqttHistoryMessage)
      : null;
  $: selectedMessagePayload = selectedMessage?.payload.toString() ?? null;
  $: selectedMessageRetained = selectedMessage?.retain ?? false;

  $: selectedMessagePayload,
    (() => {
      // Auto-format to JSON if the payload is a valid JSON string
      try {
        if (selectedMessagePayload === null) {
          return null;
        }
        JSON.parse(selectedMessagePayload);
        // It's valid JSON
        $selectedTopicStore.options.format = "json-prettier";
      } catch (e) {
        // It isn't valid JSON
        $selectedTopicStore.options.format = "none";
      }
    })();

  $: isComparing = $selectedTopicStore.options.compare;
  $: isAutoSelectingMostRecent = $selectedTopicStore.options.autoSelect;

  $: previousMessageIndex =
    isComparing && selectedMessageIndex !== -1 ? selectedMessageIndex - 1 : -1;
  $: previousMessage =
    previousMessageIndex !== -1
      ? $selectedTopicStore.history[previousMessageIndex]
      : null;
  $: prevMessageRetained = previousMessage?.retain ?? false;
  $: previousMessagePayload = previousMessage?.payload.toString() ?? null;
</script>

<div
  class="size-full max-h-full flex flex-col
    bg-elevation-1 border-l-[1px] border-l-outline p-4 pt-0"
>
  <PanelHeader
    ><div class="relative min-h-[50px] h-full">
      <div class="flex gap-1 items-center min-h-[50px] max-w-full h-full py-2">
        <Topic topic={selectedTopicString ?? ""} />
        <div class="grow"></div>
        <DropdownMenu>
          <div slot="trigger" class="">
            <IconButton>
              <Icon type="menu" size={16} />
            </IconButton>
          </div>
          <div slot="menu-content" class="flex flex-col gap-5 p-2">
            <Switch
              name="AutoSelectRecent"
              label="Auto-select most recent"
              defaultChecked={isAutoSelectingMostRecent}
              onChange={(checked) => selectedTopicStore.setAutoSelect(checked)}
            />
            <Switch
              name="ComparePreviousPayload"
              label="Compare previous message"
              defaultChecked={isComparing}
              onChange={(checked) => selectedTopicStore.setComparing(checked)}
            />
            <DropdownCloseOnClick>
              <Button
                variant="text"
                on:click={() =>
                  !!$selectedTopicStore.selectedTopic
                    ? deleteRetainedMessage($selectedTopicStore.selectedTopic)
                    : undefined}
                ><div class="flex mr-[17px] ml-2">
                  <Icon type="delete" size={20} />
                </div>
                <span>Delete retained message</span></Button
              >
            </DropdownCloseOnClick>
          </div>
        </DropdownMenu>
        <IconButton onClick={selectedTopicStore.deselectTopic}>
          <Icon type="close" size={18} />
        </IconButton>
      </div>
    </div></PanelHeader
  >
  <div class="h-[100px] min-h-[100px] overflow-hidden relative">
    <MessageTimeline
      {connectionId}
      {firstConnectedAtMs}
      {selectedTopicStore}
      bind:isAutoSelectingMostRecent={$selectedTopicStore.options.autoSelect}
      onMessageSelect={(id) => {
        selectedMessageId = id;
      }}
    />
  </div>
  {#if selectedMessage === null}
    <div class="mt-12 flex justify-center text-secondary-text">
      No message selected
    </div>
  {:else}
    {#if mqttVersion === "3"}
      <div class="w-full min-h-0 grow mt-3">
        {#if selectedMessagePayload !== null}
          <PayloadTab
            bind:codec={$selectedTopicStore.options.decoding}
            bind:format={$selectedTopicStore.options.format}
            {isComparing}
            payload={selectedMessagePayload}
            payloadLeftForCompare={previousMessagePayload}
          />
        {/if}
      </div>
    {:else}
      <Tabs
        class="w-full grow min-h-0"
        tabs={[
          { title: "Payload" },
          { title: "Headers" },
          { title: "Properties" },
        ]}
      >
        <div slot="tab-1" class="size-full pt-2">
          {#if selectedMessagePayload !== null}
            <PayloadTab
              bind:codec={$selectedTopicStore.options.decoding}
              bind:format={$selectedTopicStore.options.format}
              {isComparing}
              payload={selectedMessagePayload}
              payloadLeftForCompare={previousMessagePayload}
            />
          {/if}
        </div>
        <div slot="tab-2" class="size-full pt-2">
          {#if !!selectedMessage.properties}
            <HeadersTab
              {isComparing}
              headers={selectedMessage.properties}
              headersToCompare={previousMessage?.properties}
            />
          {/if}
        </div>
        <div slot="tab-3" class="size-full pt-2">
          {#if !!selectedMessage.properties}
            <UserPropertiesTab
              {isComparing}
              userProperties={selectedMessage.properties.userProperties}
              userPropertiesToCompare={previousMessage?.properties
                ?.userProperties}
            />
          {/if}
        </div>
      </Tabs>
    {/if}
    <SelectedMessageArrivalDetails
      class="mt-2"
      {isComparing}
      selectedArrivedAtMs={selectedMessage.timeMs}
      selectedRetain={selectedMessageRetained}
      previousRetain={prevMessageRetained}
      previousArrivedAtMs={previousMessage?.timeMs ?? null}
    />
  {/if}
</div>
