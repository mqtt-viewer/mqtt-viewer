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

  // status text + dot colour shown at the top of the dropdown
  $: statusColorClass = isConnected
    ? "text-success"
    : isBusy
      ? "text-warning"
      : "text-secondary-text";
  $: statusLabel = isConnected
    ? `Connected${connection.latencyMs !== undefined ? ` · ${connection.latencyMs} ms` : ""}`
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
    <DropdownMenu placement="bottom-start">
      <div
        slot="trigger"
        class="flex items-center gap-2 py-1 rounded hover:bg-hovered cursor-pointer max-w-full"
      >
        <div class="size-4 min-w-4"><ConnectionIdenticon {connection} /></div>
        <span class="text-lg text-emphasis truncate">{details.name}</span>
        <span class={`size-[6px] rounded-full ${isConnected ? "bg-success" : isBusy ? "bg-warning" : "bg-transparent"}`}
        ></span>
        <Icon type="down" size={10} />
      </div>
      <div class="flex flex-col min-w-[220px]" slot="menu-content">
        <div class="px-2 pt-1 pb-2">
          <div class="text-sm text-secondary-text truncate">
            {connection.connectionString}
          </div>
          <div class={`text-sm ${statusColorClass}`}>{statusLabel}</div>
        </div>
        <div class="border-t border-divider my-1"></div>
        <DropdownMenuItem onClick={toggleConnect}>
          {isConnected || isBusy ? "Disconnect" : "Connect"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => ($isEditOpen = true)}>
          Edit connection…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => (isRenaming = true)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => ($isLogsOpen = true)}>
          View logs
        </DropdownMenuItem>
        <DropdownMenuItem
          class="hover:text-error"
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
