<script lang="ts">
  import type { Connection } from "@/stores/connections";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import { twMerge } from "tailwind-merge";
  import moment from "moment";
  import Card from "@/components/Card/Card.svelte";
  import tabs from "@/stores/tabs";
  import connections from "@/stores/connections";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import { capitalizeFirstLetter } from "@/util/strings";
  import ConnectionStatusCircle from "@/components/ConnectionStatusCircle/ConnectionStatusCircle.svelte";
  import _ from "lodash";

  export let connection: Connection;

  let onConnectionClick = async () => {
    const connectionId = connection.connectionDetails.id;
    try {
      if (connection.connectionState === "connecting") {
        return;
      }
      if (connection.connectionState === "connected") {
        tabs.selectTab(connectionId);
        return;
      }
      await connections.connect(connectionId);
      tabs.selectTab(connectionId);
    } catch (e) {
      const eString = e as unknown as string;
      console.error(eString);
      addToast({
        data: {
          title: "Failed to connect",
          description: eString,
          type: "error",
        },
      });
    }
  };

  const onEditConnection = async () => {
    if (connection.connectionState === "connected") {
      addToast({
        data: {
          title: "Cannot edit active connection",
          description: "Please disconnect before editing this connection",
          type: "error",
        },
      });
      return;
    }
    connections.toggleShowDataPageWhileDisconnected(
      connection.connectionDetails.id,
      false
    );
    tabs.selectTab(connection.connectionDetails.id);
  };

  const getLastConnectedString = (lastConnectedAt: Date | null) => {
    if (!lastConnectedAt) {
      return "";
    }
    const daysAgo = moment().diff(lastConnectedAt, "days");
    if (daysAgo < 1) {
      return `Today at ${moment(lastConnectedAt).format("HH:mm")}`;
    }
    if (daysAgo < 2) {
      return `Yesterday at ${moment(lastConnectedAt).format("HH:mm")}`;
    }
    if (daysAgo < 99) {
      return `${daysAgo} days ago at ${moment(lastConnectedAt).format("HH:mm")}`;
    }
    return `99+ days ago`;
  };

  $: lastConnectedString = getLastConnectedString(
    connection.connectionDetails.lastConnectedAt
  );
</script>

<Card
  class={twMerge(
    "w-full flex py-1 px-4 items-center bg-elevation-1 group relative z-0"
  )}
  onClick={onConnectionClick}
>
  <button
    class={`absolute right-1 top-1 p-2
opacity-0 group-hover:opacity-100
transition-opacity duration-200`}
    on:click={(e) => {
      e.stopPropagation();
      onEditConnection();
    }}
  >
    <Tooltip text="Edit connection details" placement="top">
      <div
        class="rounded-full transition-colors text-secondary-text hover:text-white"
      >
        <Icon type="edit" size={15} />
      </div>
    </Tooltip>
  </button>
  <div class="w-[72px] h-[72px] -ml-[12px] mr-1">
    <ConnectionIdenticon {connection} />
  </div>
  <div class="flex-grow flex flex-col py-3 gap-1 text-left">
    <span class="font-semibold truncate"
      >{connection.connectionDetails.name}</span
    >
    <span class="text-secondary-text truncate"
      >{connection.connectionString}</span
    >
  </div>
  <div
    class="text-secondary-text text-end max-w-[140px] h-[44px] flex flex-col justify-end"
  >
    {#if connection.connectionState === "connected" || connection.connectionState === "connecting"}
      <div>
        <span class="inline-block size-[8px] mr-1"
          ><ConnectionStatusCircle state={connection.connectionState} /></span
        >
        {capitalizeFirstLetter(connection.connectionState)}
      </div>
    {:else if lastConnectedString !== ""}
      <Tooltip
        placement="top"
        text={`This connection was last connected ${_.lowerCase(lastConnectedString)}`}
      >
        <div class="text-secondary-text flex items-center gap-1">
          <div class="min-w-[14px]">
            <Icon type="lastConnected" size={14} />
          </div>
          <span>
            {lastConnectedString}
          </span>
        </div>
      </Tooltip>
    {/if}
  </div>
</Card>
