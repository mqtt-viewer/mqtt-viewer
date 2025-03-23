<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import type { Connection } from "@/stores/connections";
  import { writable } from "svelte/store";

  export let isOpen = writable(false);
  export let connection: Connection;
  export let onConfirm = undefined as (() => void) | undefined;
  export let onCancel = () => isOpen.set(false);

  $: onDeleteConfirm = () => {
    onConfirm?.();
    isOpen.set(false);
  };
</script>

<Dialog {isOpen} title="Are you sure you want to delete this connection?">
  <div class="flex flex-col gap-3 mt-3">
    <p>You're about to delete the following connection:</p>
    <div class="flex gap-1 self-center items-center">
      <span class="inline-block size-7"
        ><ConnectionIdenticon {connection} /></span
      >{connection.connectionDetails.name}
    </div>
    <p>This cannot be undone.</p>
    <div class="flex gap-3 justify-end items-center">
      <Button variant="text" on:click={onCancel}>Cancel</Button>
      <Button
        iconType="delete"
        class="text-error enabled:hover:text-error-light enabled:group-hover:text-error-light"
        iconPlacement="left"
        iconSize={16}
        on:click={onDeleteConfirm}>Delete</Button
      >
    </div>
  </div>
</Dialog>
