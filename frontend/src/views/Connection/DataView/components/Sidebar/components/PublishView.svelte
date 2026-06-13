<script lang="ts">
  import type * as models from "bindings/mqtt-viewer/backend/models/models";
  import Button from "@/components/Button/Button.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import Tabs from "@/components/Tabs/Tabs.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import ProtobufLogo from "@/components/ProtobufLogo/ProtobufLogo.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { untypedColors } from "@/util/resolvedTailwindConfig";
  import { twMerge } from "tailwind-merge";
  import _ from "lodash";
  import type { Connection } from "@/stores/connections";
  import PayloadTab from "../../PublishPanel/components/PayloadTab.svelte";
  import HeadersTab from "../../PublishPanel/components/HeadersTab/HeadersTab.svelte";
  import UserPropertiesTab from "../../PublishPanel/components/UserPropertiesTab.svelte";
  import {
    snapshotPublishDetails,
    type PublishDetailsStore,
  } from "../../PublishPanel/stores/publish-details";
  import type { createPublishHistoryStore } from "../../PublishPanel/stores/publish-history";
  import type {
    CollectionScope,
    CollectionsStore,
  } from "../stores/collections";
  import AddToCollectionMenu from "./AddToCollectionMenu.svelte";

  export let connection: Connection;
  export let isPublishDisabled: boolean;
  export let getTopicMatchesSubscription: (
    topic: string
  ) => Promise<models.Subscription | null>;
  export let publishStore: PublishDetailsStore;
  export let publishHistoryStore: ReturnType<typeof createPublishHistoryStore>;
  export let collectionsStore: CollectionsStore;
  export let onBack: () => void;

  const connectionId = connection.connectionDetails.id;

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

  const getMatchingProtoDescriptor = (
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
        matchingSub = null;
      }
    })();

  $: isSavedMessage = $publishStore.sourceMessageId !== null;
  $: isModified =
    $publishStore.baseline !== null &&
    snapshotPublishDetails($publishStore) !== $publishStore.baseline;

  const userPropertiesString = () => {
    const userProperties = publishStore.getUserProperties();
    return Object.keys(userProperties).length > 0
      ? JSON.stringify(userProperties)
      : undefined;
  };

  const messageParamsFromStore = () => ({
    topic: $publishStore.topic,
    payload: $publishStore.payload,
    qos: $publishStore.qos,
    retain: $publishStore.retain,
    encoding: $publishStore.codec,
    format: $publishStore.format,
    userProperties: userPropertiesString(),
    headerContentType: $publishStore.properties.contentType,
    headerResponseTopic: $publishStore.properties.responseTopic,
    headerCorrelationData: $publishStore.properties.correlationData,
    headerPayloadFormatIndicator: $publishStore.properties.payloadFormatIndicator,
    headerMessageExpiryInterval: $publishStore.properties.messageExpiryInterval,
    headerTopicAlias: $publishStore.properties.topicAlias,
    headerSubscriptionIdentifier: $publishStore.properties.subscriptionIdentifier,
  });

  // Writes the scratch copy back to the saved collection message.
  const saveMessage = async () => {
    if ($publishStore.sourceMessageId === null) return;
    try {
      const saved = await collectionsStore.saveMessage({
        id: $publishStore.sourceMessageId,
        collectionId: $publishStore.sourceCollectionId!,
        name: $publishStore.sourceMessageName ?? $publishStore.topic,
        ...messageParamsFromStore(),
      });
      publishStore.markSaved(saved);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to save message",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  // First save of a new message into a collection; named after its topic.
  const saveNewToCollection = async (collectionId: number) => {
    try {
      const saved = await collectionsStore.saveMessage({
        collectionId,
        name: $publishStore.topic || "Untitled message",
        ...messageParamsFromStore(),
      });
      publishStore.markSaved(saved);
      addToast({
        data: {
          title: "Message saved to collection",
          description: saved.name,
          type: "success",
        },
      });
    } catch (e) {
      addToast({
        data: {
          title: "Failed to save message",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const createAndSave = async (name: string, scope: CollectionScope) => {
    try {
      const created = await collectionsStore.createCollection(name, scope);
      await saveNewToCollection(created.id);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to create collection",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  $: publishMqtt = async () => {
    try {
      await publishStore.publish();
      // publish() validates and returns without sending on an empty topic —
      // don't record a history entry for a message that never went out
      if (!$publishStore.topic || $publishStore.topicError) {
        return;
      }
      const userProperties = publishStore.getUserProperties();
      await publishHistoryStore.savePublishEntry({
        connectionId,
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
  const fieldHoverColor = "var(--color-hovered)";
</script>

<div class="size-full flex flex-col p-4 pt-3 min-h-0">
  <div class="flex items-center gap-2 mb-3 min-w-0">
    <Tooltip text="Back to messages">
      <IconButton onClick={onBack}>
        <Icon type="back" size={16} />
      </IconButton>
    </Tooltip>
    {#if isSavedMessage}
      <span class="text-base text-emphasis truncate grow">
        {$publishStore.sourceMessageName}
      </span>
    {:else}
      <span class="text-base text-emphasis truncate grow">New message</span>
      <AddToCollectionMenu
        {collectionsStore}
        placeholder="Add message to..."
        onSelect={saveNewToCollection}
        onCreate={createAndSave}
      >
        <div
          slot="trigger"
          class="flex items-center gap-1 text-secondary-text hover:text-emphasis whitespace-nowrap"
        >
          <Icon type="plus" size={12} />
          <span class="text-base">Add to collection</span>
        </div>
      </AddToCollectionMenu>
    {/if}
  </div>

  <div class="grow flex min-h-0 flex-col">
    <div class="relative">
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
            <div class="text-sm flex-1 min-w-0 text-ellipsis overflow-hidden">
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
    </div>
    <div class="w-full flex gap-2 mt-2 items-center">
      {#if isSavedMessage && isModified}
        <span class="text-sm text-warning">Modified (unsaved)</span>
      {/if}
      <div class="grow"></div>
      {#if isSavedMessage}
        <Button
          variant="secondary"
          disabled={!isModified}
          on:click={saveMessage}>Save</Button
        >
      {/if}
      <Button
        disabled={!!$publishStore.topicError || isPublishDisabled}
        on:click={publishMqtt}
        class="text-base">Publish</Button
      >
    </div>
  </div>
</div>
