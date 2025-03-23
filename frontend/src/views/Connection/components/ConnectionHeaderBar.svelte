<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import PageHeaderBar from "@/components/PageHeaderBar/PageHeaderBar.svelte";
  import connections, { type Connection } from "@/stores/connections";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import ConnectionStatusCircle from "@/components/ConnectionStatusCircle/ConnectionStatusCircle.svelte";
  import { capitalizeFirstLetter } from "@/util/strings";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";

  export let connection: Connection;
  export let connectionIsValid: boolean;

  const connect = async () => {
    try {
      await connections.connect(connection.connectionDetails.id);
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

  const disconnect = async () => {
    try {
      await connections.disconnect(connection.connectionDetails.id);
    } catch (e) {
      console.error(e);
    }
  };

  const switchView = () => {
    connections.toggleShowDataPageWhileDisconnected(
      connection.connectionDetails.id,
      !connection.showDataPageWhileDisconnected
    );
  };

  const connectButtonClass =
    "absolute top-1/2 -translate-y-1/2 right-5 flex items-center gap-2";

  const switchViewButtonClass =
    "absolute top-1/2 -translate-y-1/2 left-5 flex items-center gap-2";

  $: showConnectionStatus =
    connection.connectionState === "connected" ||
    connection.connectionState === "reconnecting" ||
    connection.connectionState === "connecting";

  $: showSwitchViewButton =
    !!connection.firstConnectedThisSessionAtMs &&
    connection.connectionState === "disconnected";
</script>

<PageHeaderBar>
  <div class="relative size-full flex gap-4 justify-center items-center">
    <div class="flex gap-1 items-center">
      <div class="size-6"><ConnectionIdenticon {connection} /></div>
      <span class="font-semibold text-white"
        >{connection.connectionDetails.name}</span
      >
    </div>

    <span class="text-secondary-text">
      {connection.connectionString}
    </span>

    {#if showConnectionStatus}
      <div class={connectButtonClass}>
        <ConnectionStatusCircle state={connection.connectionState} />
        <span class="select-auto"
          >{capitalizeFirstLetter(connection.connectionState)}</span
        >
        {connection.connectionState === "connected" &&
        connection.latencyMs !== undefined
          ? `(${connection.latencyMs} ms)`
          : ""}
        {#if connection.connectionState === "connected" || connection.connectionState === "connecting"}
          <Tooltip text="Disconnect">
            <Button on:click={disconnect} disabled={!connectionIsValid}
              ><Icon type="disconnect" /></Button
            >
          </Tooltip>
        {/if}
      </div>
    {:else}
      <Button
        on:click={connect}
        disabled={!connectionIsValid}
        class={connectButtonClass}><Icon type="connect" />Connect</Button
      >
    {/if}
    <div class={switchViewButtonClass}>
      {#if !connection.showDataPageWhileDisconnected}
        <Button
          on:click={switchView}
          variant="text"
          iconPlacement="right"
          iconType="right"
          iconSize={14}>Show data</Button
        >
      {:else}
        <Button
          on:click={switchView}
          variant="text"
          iconPlacement="left"
          iconType="left"
          iconSize={14}
          iconClass="pb-[2px]">Connection Details</Button
        >
      {/if}
    </div>
  </div>
</PageHeaderBar>
