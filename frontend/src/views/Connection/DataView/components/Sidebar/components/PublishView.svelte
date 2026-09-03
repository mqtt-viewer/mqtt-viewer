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
  import InlineNameInput from "./InlineNameInput.svelte";
  import { writable } from "svelte/store";

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

  let isRenaming = false;
  // Guards the pending-draft Save against a double click inserting twice:
  // pendingCollection only clears once markSaved resolves.
  let isSaving = false;
  // Open state of the Add to collection menu; the chip tooltip hides while
  // the menu is open so it cannot sit over the list.
  const collectionMenuOpen = writable(false);
  $: displayName = isSavedMessage
    ? ($publishStore.sourceMessageName ?? "")
    : $publishStore.name || "Untitled message";

  // The chip is derived from the collections store so a deleted collection
  // drops out of the header on its own.
  $: pendingCollection =
    $publishStore.pendingCollectionId === null
      ? null
      : ($collectionsStore.collections.find(
          (c) => c.id === $publishStore.pendingCollectionId
        ) ?? null);
  $: if (
    $publishStore.pendingCollectionId !== null &&
    pendingCollection === null &&
    $collectionsStore.isLoaded
  ) {
    publishStore.setPendingCollection(null);
  }

  // Collection a saved message lives in; drives the same chip as a draft's
  // pending collection, but picking another one moves the message.
  $: currentCollection =
    $publishStore.sourceCollectionId === null
      ? null
      : ($collectionsStore.collections.find(
          (c) => c.id === $publishStore.sourceCollectionId
        ) ?? null);
  $: chipCollection = isSavedMessage ? currentCollection : pendingCollection;
  $: chipTooltip =
    chipCollection === null || $collectionMenuOpen
      ? ""
      : isSavedMessage
        ? `In ${chipCollection.name}`
        : `Will be saved to ${chipCollection.name}`;

  // Moves a saved message to another collection. The store updates both
  // folders and their counts; only the editor's collection id needs syncing.
  const moveSavedMessage = async (collectionId: number) => {
    if (
      $publishStore.sourceMessageId === null ||
      collectionId === $publishStore.sourceCollectionId
    ) {
      return;
    }
    try {
      await collectionsStore.moveMessage(
        $publishStore.sourceMessageId,
        collectionId
      );
      publishStore.setPartial({ sourceCollectionId: collectionId });
    } catch (e) {
      addToast({
        data: {
          title: "Failed to move message",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const createAndMove = async (name: string, scope: CollectionScope) => {
    try {
      const created = await collectionsStore.createCollection(name, scope);
      await moveSavedMessage(created.id);
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

  // Draft: the name lives on the draft until it is saved. Saved message:
  // persisted through the same rename path the sidebar row uses.
  const commitRename = async (name: string) => {
    isRenaming = false;
    if (!isSavedMessage) {
      publishStore.setName(name);
      return;
    }
    if (!name || name === $publishStore.sourceMessageName) return;
    try {
      await collectionsStore.renameMessage($publishStore.sourceMessageId!, name);
      publishStore.setPartial({ sourceMessageName: name, name });
    } catch (e) {
      addToast({
        data: {
          title: "Failed to rename message",
          description: e as string,
          type: "error",
        },
      });
    }
  };

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

  // First save of a new message into a collection; named after the draft,
  // falling back to its topic.
  const saveNewToCollection = async (collectionId: number) => {
    try {
      const saved = await collectionsStore.saveMessage({
        collectionId,
        name:
          $publishStore.name.trim() ||
          $publishStore.topic ||
          "Untitled message",
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

  const savePendingDraft = async () => {
    if (pendingCollection === null || isSaving) return;
    isSaving = true;
    try {
      await saveNewToCollection(pendingCollection.id);
    } finally {
      isSaving = false;
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
    {#if isRenaming}
      <div class="grow min-w-0">
        <InlineNameInput
          name="rename-publish-message"
          initialValue={isSavedMessage
            ? ($publishStore.sourceMessageName ?? "")
            : $publishStore.name}
          selectAll
          onCommit={commitRename}
          onCancel={() => (isRenaming = false)}
        />
      </div>
    {:else}
      <!-- Hugs the name plus pencil; min-w-0 lets a long name truncate. -->
      <Tooltip text="Rename" class="flex min-w-0 max-w-full">
        <button
          class="group inline-flex items-center gap-1 min-w-0 max-w-full px-1 -mx-1 py-[2px] rounded hover:bg-hovered cursor-pointer text-left"
          on:click={() => (isRenaming = true)}
        >
          <span class="text-base text-emphasis truncate">{displayName}</span>
          <!-- Reserved width so the name does not shift when the pencil appears. -->
          <span
            class="w-4 shrink-0 flex items-center justify-center text-secondary-text opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-hover:text-emphasis"
          >
            <Icon type="edit" size={14} />
          </span>
        </button>
      </Tooltip>
      <div class="grow"></div>
    {/if}
    {#if !isSavedMessage || chipCollection !== null}
      <!-- Tooltip renders its bare slot when text is empty, so the no-chip
           case has no wrapper. Draft: picking a collection saves into it.
           Saved message: picking one moves it. -->
      <Tooltip text={chipTooltip}>
        <AddToCollectionMenu
          {collectionsStore}
          open={collectionMenuOpen}
          currentCollectionId={chipCollection?.id ?? null}
          onSelect={isSavedMessage ? moveSavedMessage : saveNewToCollection}
          onCreate={isSavedMessage ? createAndMove : createAndSave}
        >
          <div slot="trigger">
            {#if chipCollection}
              <div
                class="flex items-center gap-1 min-w-0 max-w-[160px] text-secondary-text hover:text-emphasis"
              >
                <Icon type="folder" size={12} />
                <span class="text-base truncate">{chipCollection.name}</span>
              </div>
            {:else}
              <div
                class="flex items-center gap-1 text-secondary-text hover:text-emphasis whitespace-nowrap"
              >
                <Icon type="plus" size={12} />
                <span class="text-base">Add to collection</span>
              </div>
            {/if}
          </div>
        </AddToCollectionMenu>
      </Tooltip>
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
      {:else if pendingCollection !== null}
        <Button
          variant="secondary"
          disabled={isSaving}
          on:click={savePendingDraft}>Save</Button
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
