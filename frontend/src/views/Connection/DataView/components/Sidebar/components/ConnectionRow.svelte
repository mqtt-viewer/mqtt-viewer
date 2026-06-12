<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import DialogActionBar from "@/components/Dialog/DialogActionBar.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import connections, { type Connection } from "@/stores/connections";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { writable } from "svelte/store";

  export let connection: Connection;

  let isRenameOpen = writable(false);
  let isDeleteOpen = writable(false);
  let renameValue = "";

  const showConnectionDetails = () => {
    connections.toggleShowDataPageWhileDisconnected(
      connection.connectionDetails.id,
      false
    );
  };

  const openRename = () => {
    renameValue = connection.connectionDetails.name;
    $isRenameOpen = true;
  };

  const commitRename = async () => {
    const name = renameValue.trim();
    if (!name || name === connection.connectionDetails.name) {
      $isRenameOpen = false;
      return;
    }
    try {
      await connections.updateConnectionDetails({
        ...connection.connectionDetails,
        name,
      });
    } catch (e) {
      addToast({
        data: {
          title: "Failed to rename connection",
          description: e as string,
          type: "error",
        },
      });
    }
    $isRenameOpen = false;
  };

  const deleteConnection = async () => {
    try {
      await connections.deleteConnection(connection.connectionDetails.id);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to delete connection",
          description: e as string,
          type: "error",
        },
      });
    }
    $isDeleteOpen = false;
  };
</script>

<div class="px-3">
  <DropdownMenu placement="bottom-start">
    <div
      slot="trigger"
      class="flex items-center gap-2 py-1 rounded hover:bg-hovered cursor-pointer max-w-full"
    >
      <div class="size-4 min-w-4"><ConnectionIdenticon {connection} /></div>
      <span class="text-lg text-emphasis truncate">
        {connection.connectionDetails.name}
      </span>
      <Icon type="down" size={10} />
    </div>
    <div class="flex flex-col" slot="menu-content">
      <DropdownMenuItem onClick={showConnectionDetails}
        >Connection details</DropdownMenuItem
      >
      <DropdownMenuItem onClick={openRename}>Rename</DropdownMenuItem>
      <DropdownMenuItem
        class="hover:text-error"
        onClick={() => ($isDeleteOpen = true)}>Delete</DropdownMenuItem
      >
    </div>
  </DropdownMenu>
</div>

<Dialog title="Rename connection" isOpen={isRenameOpen} startEmpty>
  <form
    class="flex flex-col gap-4 min-w-[300px]"
    on:submit|preventDefault={commitRename}
  >
    <BaseInput
      bind:value={renameValue}
      name="connection-name"
      placeholder="Connection name"
    />
    <DialogActionBar>
      <Button variant="secondary" on:click={() => ($isRenameOpen = false)}
        >Cancel</Button
      >
      <Button type="submit">Rename</Button>
    </DialogActionBar>
  </form>
</Dialog>

<Dialog
  title="Delete connection"
  description={`Delete "${connection.connectionDetails.name}"? Its publish history and connection-scoped collections will also be deleted.`}
  isOpen={isDeleteOpen}
>
  <DialogActionBar>
    <Button variant="secondary" on:click={() => ($isDeleteOpen = false)}
      >Cancel</Button
    >
    <Button class="bg-error" on:click={deleteConnection}>Delete</Button>
  </DialogActionBar>
</Dialog>
