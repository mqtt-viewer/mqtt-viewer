<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import type { Connection } from "@/stores/connections";
  import { writable } from "svelte/store";

  export let open = writable(false);
  export let connection: Connection | null = null;
  export let onConfirm = undefined as (() => void) | undefined;
  export let onCancel = () => open.set(false);
</script>

<Dialog
  isOpen={open}
  showCloseButton={false}
  title="Are you sure you want to disconnect?"
>
  <div class="flex flex-col gap-6 mt-4">
    <p>
      {`Closing this tab will disconnect the following connection:`}
    </p>
    <div class="w-full flex justify-center gap-1">
      {#if connection !== null}
        <div class="size-5">
          <ConnectionIdenticon {connection} />
        </div>
        {connection.connectionDetails.name}
      {/if}
    </div>
    <div class="min-w-[330px] flex gap-3 justify-end items-center">
      <Button variant="secondary" on:click={onCancel}>Cancel</Button>
      <Button
        variant="primary"
        iconType="disconnect"
        iconPlacement="right"
        iconSize={16}
        on:click={onConfirm}>Disconnect</Button
      >
    </div>
  </div>
</Dialog>
