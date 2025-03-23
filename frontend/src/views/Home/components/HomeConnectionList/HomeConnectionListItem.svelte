<script lang="ts">
  import type { Connection } from "@/stores/connections";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import tabs from "@/stores/tabs";
  import moment from "moment";
  import Card from "@/components/Card/Card.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import connections from "@/stores/connections";
  import ConnectionStatusCircle from "@/components/ConnectionStatusCircle/ConnectionStatusCircle.svelte";
  import { capitalizeFirstLetter } from "@/util/strings";
  import _ from "lodash";

  let className = "";
  export { className as class };

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
      if ($tabs.isMaxTabsReached) {
        tabs.addTab(connectionId);
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

<Card onClick={onConnectionClick} class="bg-elevation-1 p-0 group relative ">
  <div
    class={`
      absolute top-0 left-0
      text-sm text-secondary-text 
      w-full pt-2 pl-2 
      flex items-center justify-between
      z-10
    `}
  >
    <div class="w-fit">
      {#if connection.connectionState === "connected" || connection.connectionState === "connecting"}
        <span class="inline-block size-[8px] mr-1"
          ><ConnectionStatusCircle state={connection.connectionState} /></span
        >
        {capitalizeFirstLetter(connection.connectionState)}
      {:else if lastConnectedString !== ""}
        <Tooltip
          placement="top"
          text={`This connection was last connected ${_.lowerCase(lastConnectedString)}`}
        >
          <div class="text-secondary-text flex items-center gap-1">
            <Icon type="lastConnected" size={14} />
            <span>
              {lastConnectedString}
            </span>
          </div>
        </Tooltip>
      {/if}
    </div>
    <button
      class={`absolute right-0 top-0 p-2
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
  </div>
  <div class="relative">
    <ConnectionIdenticon {connection} />
  </div>
  <div class="px-4 pb-4 relative -mt-3">
    <div class="text-lg font-bold truncate text-center">
      {connection.connectionDetails.name}
    </div>
    <div class="text-secondary-text truncate">
      {connection.connectionString}
    </div>
  </div>
</Card>
