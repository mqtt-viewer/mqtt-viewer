<script lang="ts">
  import { PublishMqtt } from "wailsjs/go/app/App";
  import type { app, models, mqtt } from "wailsjs/go/models";
  import Button from "@/components/Button/Button.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import Tabs from "@/components/Tabs/Tabs.svelte";
  import PayloadTab from "./components/PayloadTab.svelte";
  import UserPropertiesTab from "./components/UserPropertiesTab.svelte";
  import PanelHeader from "@/components/PanelHeader/PanelHeader.svelte";
  import type { Connection } from "@/stores/connections";
  import { untypedColors } from "@/util/resolvedTailwindConfig";
  import { twMerge } from "tailwind-merge";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import _ from "lodash";
  import ProtobufLogo from "@/components/ProtobufLogo/ProtobufLogo.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import HeadersTab from "./components/HeadersTab/HeadersTab.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import { encodePayload } from "@/components/CodeEditor/codec";
  import PublishHistory from "./components/PublishHistory/PublishHistory.svelte";
  import { createPublishStore } from "./stores/publish-details";
  import { getConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import { createPublishHistoryStore } from "./stores/publish-history";

  export let connection: Connection;
  export let isOpen: boolean;
  export let isPublishDisabled: boolean;
  export let open: () => void;
  export let close: () => void;
  export let getTopicMatchesSubscription: (
    topic: string
  ) => Promise<models.Subscription | null>;

  let connectionId = getConnectionIdContext();
  let publishStore = createPublishStore(connectionId);
  let publishHistoryStore = createPublishHistoryStore(
    connectionId,
    publishStore
  );

  let collapsedPanelHovered = false;

  let matchingSub: models.Subscription | null = null;
  let noMatchingSub = false;

  $: $publishStore.topic,
    (() => {
      if ($publishStore.topic === "") {
        if ($publishStore.hasAttemptedPublish) {
          publishStore.setPartial({ topicError: "Please enter a topic" });
        }
        matchingSub = null;
        noMatchingSub = false;
        debouncedGetTopicMatchesSubscription.cancel();
        return;
      }
      publishStore.setPartial({ topicError: "" });
      debouncedGetTopicMatchesSubscription($publishStore.topic);
    })();

  const debouncedGetTopicMatchesSubscription = _.debounce(
    async (topic: string) => {
      const result = await getTopicMatchesSubscription(topic);
      if (!result) {
        noMatchingSub = true;
        matchingSub = null;
        return;
      }
      noMatchingSub = false;
      matchingSub = result;
    },
    500
  );

  $: matchingProtoDescriptor = getMatchingProtoDescriptor(
    matchingSub,
    $publishStore.topic
  );

  let getMatchingProtoDescriptor = (
    sub: models.Subscription | null,
    topic: string
  ) => {
    if (!sub) {
      return null;
    }
    if (topic.startsWith("spAv1.0")) {
      return "Sparkplug A v1.0";
    }
    if (topic.startsWith("spBv1.0")) {
      return "Sparkplug B v1.0";
    }
    return null;
  };

  $: connection.connectionState,
    (() => {
      if (connection.connectionState !== "connected") {
        // Clear this on disconnect so it doesn't cache subs/protos
        // on reconnect if the user has modified the connection
        matchingSub = null;
      }
    })();

  $: publishMqtt = async () => {
    try {
      await publishStore.publish();
      const userProperties = publishStore.getUserProperties();
      console.log("got user properties to save", userProperties);
      await publishHistoryStore.savePublishEntry({
        connectionId: connectionId,
        topic: $publishStore.topic,
        payload: $publishStore.payload,
        qos: $publishStore.qos,
        retain: $publishStore.retain,
        encoding: $publishStore.codec,
        format: $publishStore.format,
        properties: $publishStore.properties,
        userProperties,
      });
    } catch (e) {
      handlePublishError(e as string);
      console.error(e);
    }
  };

  const handlePublishError = (e: string) => {
    let message = e;
    if (e.includes("proto:")) {
      message = "protobuf:" + e.split("proto:")[1];
    }
    addToast({
      data: {
        title: "Publish Error",
        description: message,
        type: "error",
      },
    });
  };

  const fieldColor = untypedColors["outline"]["DEFAULT"];
  const fieldHoverColor = untypedColors["hovered"]["DEFAULT"];
</script>

<div
  class={twMerge(
    "size-full max-h-full",
    "transition-colors",
    !isOpen && collapsedPanelHovered ? "border-r-white" : "border-r-outline",
    "bg-elevation-1 border-r-[1px]",
    "relative overflow-auto"
  )}
>
  <div class={`size-full ${isOpen ? "hidden" : ""}`}>
    <button
      on:click={open}
      on:mouseenter={() => (collapsedPanelHovered = true)}
      on:mouseleave={() => (collapsedPanelHovered = false)}
      class="size-full relative"
    >
      <div
        class={`flex gap-1 absolute top-1/2 -left-4 -rotate-90
          transition-colors
      ${collapsedPanelHovered ? "text-white" : "text-secondary-text"}`}
      >
        Publish
        <Button
          forceHover={collapsedPanelHovered}
          variant="text"
          class={`-rotate-90`}
          iconType="shiftPanelLeft"
          iconSize={16}
        />
      </div>
    </button>
  </div>
  <div class={`size-full ${!isOpen ? "hidden" : ""}`}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="size-full flex flex-col p-4 pt-0"
      aria-roledescription="panel"
      on:mousemove={() => (collapsedPanelHovered = false)}
    >
      <PanelHeader
        ><div class="relative size-full">
          <span class="flex items-center h-full">Publish</span>
          <IconButton
            class="absolute top-1/2 -translate-y-1/2 right-0"
            onClick={close}
          >
            <Icon type="shiftPanelLeft" size={16} />
          </IconButton>
        </div></PanelHeader
      >
      <div class="grow flex min-h-0 flex-col">
        <div class="relative">
          <div class="flex gap-2 items-center w-full">
            <BaseInput
              bind:value={$publishStore.topic}
              errorMessage={$publishStore.topicError ?? undefined}
              name="topic"
              placeholder="Enter a topic"
              class="grow"
              bgColor={fieldColor}
              bgHoverColor={fieldHoverColor}
              actionButtons={$publishStore.topic !== ""
                ? [
                    {
                      icon: "close",
                      tooltipText: "Clear topic",
                      onClick: (e) => {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        $publishStore.topic = "";
                      },
                    },
                  ]
                : undefined}
            />
            <PublishHistory {publishHistoryStore} />
          </div>

          <div
            class={twMerge(
              "relative h-2 w-full mt-[2px] max-w-full min-w-0",
              "text-sm text-secondary-text"
            )}
          >
            {#if noMatchingSub}
              <Tooltip
                class="w-full max-w-full items-center flex gap-1 cursor-pointer"
              >
                <div slot="tooltip-content">
                  <div class="mb-[2px]">
                    This topic doesn't match any of this connection's
                    subscriptions.
                  </div>
                  <div>
                    You won't see messages published to this topic in the data
                    display to the right.
                  </div>
                </div>
                <div class="text-sm">No matching subscription</div>
                <div class="text-warning">
                  <Icon size={11} type="warning" />
                </div>
              </Tooltip>
            {:else if matchingProtoDescriptor}
              <Tooltip
                class="w-full max-w-full items-center flex mt-[6px] ml-[10px]"
              >
                <div slot="tooltip-content">
                  <div class="mb-[2px]">
                    Messages sent to this topic will be protobuf encoded/decoded
                    according to the descriptor:
                  </div>
                  <div class="flex items-center">
                    <span class="size-4 mr-1"><ProtobufLogo isActive /></span>
                    <div class="flex-1 min-w-0 text-ellipsis overflow-hidden">
                      {matchingProtoDescriptor}
                    </div>
                  </div>
                </div>
                <div class="text-sm">Matches:</div>
                <span class="w-[12px] min-w-[12px] h-[12px] ml-2 mr-1"
                  ><ProtobufLogo isActive /></span
                >
                <div
                  class="text-sm flex-1 min-w-0 text-ellipsis overflow-hidden"
                >
                  {matchingProtoDescriptor}
                </div>
              </Tooltip>
            {/if}
          </div>
        </div>
        {#if noMatchingSub || matchingProtoDescriptor}
          <div class="h-2"></div>
        {/if}
        {#if connection.connectionDetails.mqttVersion === "3"}
          <div class="pt-2 grow w-full min-h-0">
            <PayloadTab {publishStore} />
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
              <PayloadTab {publishStore} />
            </div>
            <div slot="tab-2" class="size-full h-full pt-2">
              <HeadersTab bind:data={$publishStore.properties} />
            </div>
            <div slot="tab-3" class="size-full h-full pt-2">
              <UserPropertiesTab
                bind:userProperties={$publishStore.userPropertiesArray}
              />
            </div>
          </Tabs>
        {/if}
        <div class="w-full text-sm flex gap-2 mt-4 items-center justify-end">
          <DropdownMenu
            placement="top"
            triggerText={`QoS ${$publishStore.qos}`}
            triggerVariant="text"
            triggerClass="px-0 py-[3px]"
            triggerIconSize={12}
            ><div class="flex flex-col" slot="menu-content">
              <DropdownMenuItem
                isSelected={$publishStore.qos === 0}
                onClick={() => {
                  $publishStore.qos = 0;
                }}>QoS 0 - At most once</DropdownMenuItem
              >
              <DropdownMenuItem
                isSelected={$publishStore.qos === 1}
                onClick={() => {
                  $publishStore.qos = 1;
                }}>QoS 1 - At least once</DropdownMenuItem
              >
              <DropdownMenuItem
                isSelected={$publishStore.qos === 2}
                onClick={() => {
                  $publishStore.qos = 2;
                }}>QoS 2 - Exactly once</DropdownMenuItem
              >
            </div></DropdownMenu
          >

          <DropdownMenu
            placement="top"
            triggerText={`${$publishStore.retain ? "Retain" : "Don't Retain"}`}
            triggerClass={twMerge(
              "px-2 py-[3px]",
              $publishStore.retain && "text-secondary"
            )}
            triggerVariant="text"
            triggerIconSize={12}
            ><div class="flex flex-col" slot="menu-content">
              <DropdownMenuItem
                isSelected={$publishStore.retain}
                onClick={() => {
                  $publishStore.retain = true;
                }}>Retain</DropdownMenuItem
              >
              <DropdownMenuItem
                isSelected={!$publishStore.retain}
                onClick={() => {
                  $publishStore.retain = false;
                }}>Don't Retain</DropdownMenuItem
              >
            </div></DropdownMenu
          >
          <Button
            disabled={!!$publishStore.topicError || isPublishDisabled}
            on:click={publishMqtt}
            class="self-end text-base">Send</Button
          >
        </div>
      </div>
    </div>
  </div>
</div>
