<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import ConfirmDeleteConnectionDialog from "@/views/Connection/ConnectionDetailsView/components/ConfirmDeleteConnectionDialog/ConfirmDeleteConnectionDialog.svelte";
  import connections, { type Connection } from "@/stores/connections";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { capitalizeFirstLetter } from "@/util/strings";
  import { writable } from "svelte/store";
  import InlineNameInput from "./InlineNameInput.svelte";
  import ConnectionDetailsDialog from "./ConnectionDetailsDialog.svelte";
  import ConnectionLogsDialog from "./ConnectionLogsDialog.svelte";

  export let connection: Connection;

  let isDeleteOpen = writable(false);
  let isEditOpen = writable(false);
  let isLogsOpen = writable(false);
  let isRenaming = false;

  $: details = connection.connectionDetails;
  $: state = connection.connectionState;
  $: isConnected = state === "connected";
  $: isBusy = state === "connecting" || state === "reconnecting";

  $: isError = state === "error";

  // status text + dot colour shown at the top of the dropdown
  $: statusColorClass = isConnected
    ? "text-success"
    : isBusy
      ? "text-warning"
      : isError
        ? "text-error"
        : "text-secondary-text";
  $: statusLabel = isConnected
    ? `Connected${connection.latencyMs !== undefined ? ` · ${connection.latencyMs} ms` : ""}`
    : isError
      ? (connection.lastConnectionError ?? "Connection failed")
      : capitalizeFirstLetter(state);

  // A connection just created this session opens straight into the details
  // dialog so the user can configure it before connecting.
  onMount(() => {
    if (connection.justCreated) {
      $isEditOpen = true;
      connections.acknowledgeConnectionCreated(details.id);
    }
  });

  const toggleConnect = async () => {
    // An unconfigured connection can't connect — send them to set it up first.
    if (!isConnected && !isBusy && !details.host) {
      $isEditOpen = true;
      return;
    }
    try {
      if (isConnected || isBusy) {
        await connections.disconnect(details.id);
      } else {
        await connections.connect(details.id);
      }
    } catch (e) {
      addToast({
        data: {
          title: isConnected ? "Failed to disconnect" : "Failed to connect",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const commitRename = async (name: string) => {
    isRenaming = false;
    if (!name || name === details.name) return;
    try {
      await connections.updateConnectionDetails({ ...details, name });
    } catch (e) {
      addToast({
        data: {
          title: "Failed to rename connection",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const deleteConnection = async () => {
    try {
      await connections.deleteConnection(details.id);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to delete connection",
          description: e as string,
          type: "error",
        },
      });
    }
  };
</script>

<div class="px-3">
  {#if isRenaming}
    <InlineNameInput
      name="connection-name"
      initialValue={details.name}
      placeholder="Connection name"
      onCommit={commitRename}
      onCancel={() => (isRenaming = false)}
    />
  {:else}
    <DropdownMenu placement="bottom-start" triggerButtonClass="w-full">
      <div
        slot="trigger"
        class="flex items-center gap-2 px-1 -mx-1 py-1 rounded hover:bg-hovered cursor-pointer"
      >
        <div class="w-5 shrink-0 flex items-center justify-center">
          <div class="size-4"><ConnectionIdenticon {connection} /></div>
        </div>
        <span class="text-lg text-emphasis truncate">{details.name}</span>
        <span class={`size-[6px] rounded-full ${isConnected ? "bg-success" : isBusy ? "bg-warning" : isError ? "bg-error" : "bg-transparent"}`}
        ></span>
        <Icon type="down" size={10} />
      </div>
      <div class="flex flex-col min-w-[220px] max-w-[280px]" slot="menu-content">
        <div class="px-2 pt-1 pb-2">
          <div class="text-sm text-secondary-text truncate">
            {connection.connectionString}
          </div>
          <div class={`text-sm break-words ${statusColorClass}`}>
            {statusLabel}
          </div>
        </div>
        <div class="border-t border-divider my-1"></div>
        <DropdownMenuItem
          iconType={isConnected || isBusy ? "disconnect" : "connect"}
          onClick={toggleConnect}
        >
          {isConnected || isBusy ? "Disconnect" : "Connect"}
        </DropdownMenuItem>
        <DropdownMenuItem
          iconType="settings"
          onClick={() => ($isEditOpen = true)}
        >
          Edit connection…
        </DropdownMenuItem>
        <DropdownMenuItem iconType="edit" onClick={() => (isRenaming = true)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => ($isLogsOpen = true)}>
          View logs
        </DropdownMenuItem>
        <DropdownMenuItem
          iconType="delete"
          class="text-error"
          onClick={() => ($isDeleteOpen = true)}>Delete</DropdownMenuItem
        >
      </div>
    </DropdownMenu>
  {/if}
</div>

<ConnectionDetailsDialog {connection} isOpen={isEditOpen} />

<ConnectionLogsDialog {connection} isOpen={isLogsOpen} />

<ConfirmDeleteConnectionDialog
  isOpen={isDeleteOpen}
  {connection}
  onConfirm={deleteConnection}
/>
