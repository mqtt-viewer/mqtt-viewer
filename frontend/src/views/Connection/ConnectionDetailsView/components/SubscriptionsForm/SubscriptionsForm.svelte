<script lang="ts">
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import { colors } from "@/util/resolvedTailwindConfig";
  import connectionsStore, { type Connection } from "@/stores/connections";
  import subscriptionsStore from "@/stores/subscriptions";
  import connectionProtobufDetailsMap from "@/stores/derived/connection-protobuf-details-by-id";
  import missingProtoDescriptorErrors from "@/stores/derived/missing-protodescriptor-errors";
  import Select from "@/components/InputFields/Select.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import FilePathPicker from "@/components/InputFields/FilePathPicker.svelte";
  import { InputColors } from "@/components/InputFields/colors.js";
  import Icon from "@/components/Icon/Icon.svelte";
  import ProtobufLogo from "@/components/ProtobufLogo/ProtobufLogo.svelte";
  import LoadedProtoDetailsDialog from "./LoadedProtoDetailsDialog/LoadedProtoDetailsDialog.svelte";
  import { writable } from "svelte/store";
  import Button from "@/components/Button/Button.svelte";
  import AddFieldButton from "@/components/Button/AddFieldButton.svelte";

  export let connection: Connection;
  $: connectionId = connection.connectionDetails.id;
  $: connectionProtobufDetails = $connectionProtobufDetailsMap[connectionId];
  $: subscriptions =
    $subscriptionsStore.subscriptionsByConnectionId[
      connection.connectionDetails.id
    ] ?? [];
  $: connectionHasMissingDescriptorErrors =
    $missingProtoDescriptorErrors.byConnId.has(connectionId) ?? false;

  $: ({ isProtoEnabled, protoRegDir } = connection.connectionDetails);

  $: onProtoEnabledChange = async (enabled: boolean) => {
    try {
      await connectionsStore.updateConnectionDetails({
        ...connection.connectionDetails,
        isProtoEnabled: enabled,
      });
    } catch (e) {
      console.error(e);
    }
  };

  $: onProtoRegistryDirAdd = async (newDir: string) => {
    try {
      if (!connection.connectionDetails.isProtoEnabled || !newDir) {
        return;
      }
      await connectionsStore.updateConnectionDetails({
        ...connection.connectionDetails,
        protoRegDir: newDir,
      });
      await connectionsStore.loadConnectionProtoRegistry(connectionId);
    } catch (e) {
      console.error(e);
    }
  };

  $: onProtoRegistryDirRemoved = async () => {
    try {
      await connectionsStore.clearConnectionProtoRegistry(connectionId);
    } catch (e) {
      throw e;
    }
  };

  $: onAddSubscriptionClick = async () => {
    try {
      await subscriptionsStore.addSubscription(connectionId);
    } catch (e) {
      console.error(e);
    }
  };

  $: onSubscriptionRemove = async (subId: number) => {
    try {
      if (subscriptions.length === 1) return;
      await subscriptionsStore.deleteSubscription(connectionId, subId);
    } catch (e) {
      console.error(e);
    }
  };

  let isProtoDetailsDialogOpen = writable(false);
  let currentSelectedDescriptor = undefined as string | undefined;
  let currentSelectedSubId = undefined as number | undefined;
  const openProtoDetailsDialog = (
    subId?: number,
    selectedDescriptor?: string
  ) => {
    currentSelectedSubId = subId;
    currentSelectedDescriptor = selectedDescriptor;
    isProtoDetailsDialogOpen.set(true);
  };

  $: onDescriptorSelect = async (descriptor: string) => {
    try {
      if (currentSelectedSubId === undefined) return;
      let newValue = descriptor;
      if (currentSelectedDescriptor === descriptor) {
        newValue = "";
        currentSelectedDescriptor = undefined;
      } else {
        currentSelectedDescriptor = descriptor;
      }
      const existingSub = subscriptions.find(
        (s) => s.id === currentSelectedSubId
      )!;
      const newSubscription = {
        ...existingSub,
        protoDescriptor: newValue,
      };
      await subscriptionsStore.updateSubscription(
        connectionId,
        newSubscription
      );
    } catch (e) {
      throw e;
    }
  };

  $: onDescriptorRemove = async (subscriptionId: number) => {
    try {
      const sub = subscriptions.find((s) => s.id === subscriptionId);
      if (!sub) return;
      const newSubscription = {
        ...sub,
        protoDescriptor: "",
      };
      await subscriptionsStore.updateSubscription(
        connectionId,
        newSubscription
      );
    } catch (e) {
      throw e;
    }
  };

  $: showDescriptorSelects =
    connection.connectionDetails.isProtoEnabled &&
    connectionProtobufDetails?.protoLoaded &&
    connectionProtobufDetails?.countLoadedDescriptors > 0;

  $: isAllFieldsDisabled = connection.connectionState !== "disconnected";
</script>

<div class="flex flex-col w-[550px]">
  <span class="text-lg mb-4">Subscriptions</span>

  <Switch
    disabled={isAllFieldsDisabled}
    onChange={onProtoEnabledChange}
    name="isProtoEnabled"
    label="Enable Protobuf encoding/decoding"
    defaultChecked={isProtoEnabled}
  />
  {#if connection.connectionDetails.isProtoEnabled}
    <div class="space-y-2 mt-4">
      <FilePathPicker
        disabled={isAllFieldsDisabled}
        variant="directory"
        actionLabel="Choose Protobuf file directory"
        valueLabel="Protobuf Directory"
        defaultValue={protoRegDir}
        onFileChosen={onProtoRegistryDirAdd}
        onFileRemoved={onProtoRegistryDirRemoved}
      />
      {#if connectionProtobufDetails?.protoLoadError}
        <div style:color={InputColors.ERROR}>
          <span class="mb-2"> Error loading protobuf files: </span>
          <div />
          <span>
            {connectionProtobufDetails.protoLoadError}
          </span>
        </div>
      {/if}
      {#if connectionProtobufDetails?.protoLoaded}
        <Button
          disabled={isAllFieldsDisabled}
          variant="text"
          iconType="files"
          iconSize={22}
          on:click={() => openProtoDetailsDialog()}
        >
          <span
            >View {connectionProtobufDetails.countLoadedFiles} loaded file{connectionProtobufDetails.countLoadedFiles !==
            1
              ? "s"
              : ""} and {connectionProtobufDetails.countLoadedDescriptors} loaded
            Descriptor{connectionProtobufDetails.countLoadedDescriptors !== 1
              ? "s"
              : ""}</span
          >
        </Button>
      {/if}
    </div>
  {/if}
</div>
<div class="mt-8 space-y-12 w-full">
  {#each subscriptions as subscription, index}
    {@const hasMissingDescriptorError =
      $missingProtoDescriptorErrors.bySubId.has(subscription.id) ?? false}
    <div class="flex gap-3 items-center">
      {#if showDescriptorSelects}
        <div class="relative w-[5%] flex items-center">
          <button
            disabled={isAllFieldsDisabled}
            class={`w-full cursor-pointer ${isAllFieldsDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
            on:click={() =>
              openProtoDetailsDialog(
                subscription.id,
                subscription.protoDescriptor
              )}
            ><ProtobufLogo isActive={!!subscription.protoDescriptor} /></button
          >
          {#if !!subscription.protoDescriptor}
            <span
              class={`absolute left-2 -bottom-[22px] text-sm flex ${
                hasMissingDescriptorError ? "text-error" : "text-secondary-text"
              } ${isAllFieldsDisabled ? "opacity-60" : ""}`}
            >
              <Icon type="subItem" size={18} />
              <span class={`mt-1 ml-2 mr-1 whitespace-nowrap`}>
                {subscription.protoDescriptor}{hasMissingDescriptorError
                  ? " (missing)"
                  : ""}
              </span>
              <Button
                disabled={isAllFieldsDisabled}
                variant="text"
                iconSize={14}
                class={`opacity-100 mt-1 ${hasMissingDescriptorError ? "text-error hover:text-error-light" : ""}`}
                iconType="closeCircle"
                on:click={() => onDescriptorRemove(subscription.id)}
              />
            </span>
          {/if}
        </div>
      {/if}
      <div class="w-[12%]">
        <Select
          disabled={isAllFieldsDisabled}
          onChange={(qos) => {
            subscriptionsStore.updateSubscription(connectionId, {
              ...subscription,
              qos: Number(qos),
            });
          }}
          sameWidth
          name={`subscriptions.${index}.qos`}
          defaultValue={subscription.qos}
          label={`QoS`}
          getOptionLabel={(option) => `${option}`}
          options={[0, 1, 2]}
        />
      </div>
      <div class={"flex-grow"}>
        <BaseInput
          disabled={isAllFieldsDisabled}
          onChange={(value) => {
            subscriptionsStore.updateSubscription(connectionId, {
              ...subscription,
              topic: value ?? "",
            });
          }}
          name={`subscriptions.${index}.topic`}
          label="Topic"
          value={subscription.topic}
        />
      </div>
      {#if subscriptions.length !== 1}
        <Button
          disabled={isAllFieldsDisabled}
          variant="text"
          iconType="closeCircle"
          on:click={() => onSubscriptionRemove(subscription.id)}
        />
      {/if}
    </div>
  {/each}
</div>
<AddFieldButton
  disabled={isAllFieldsDisabled}
  class="mt-10"
  text="Add Subscription"
  onClick={onAddSubscriptionClick}
/>
<LoadedProtoDetailsDialog
  open={isProtoDetailsDialogOpen}
  selectedDescriptor={currentSelectedDescriptor}
  selectedDescriptorIsMissing={$missingProtoDescriptorErrors.bySubId.has(
    currentSelectedSubId ?? -1
  )}
  onDescriptorSelect={currentSelectedSubId !== undefined
    ? onDescriptorSelect
    : undefined}
  loadedRootDir={protoRegDir}
  loadedProtoFilesWithDescriptorsMap={connectionProtobufDetails?.loadedFilePathsWithDescriptorsMap}
/>
